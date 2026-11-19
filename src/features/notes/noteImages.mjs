// Note photos are stored only on this PC (electron/note-image-store.cjs) and referenced by id.
// In saved notes an image run is written as a [사진:id:width] text token, so older
// installations still read and edit the surrounding note.

const noteImageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const noteImageSelector = '[data-note-image-id]';
const noteImageAlt = '메모 사진';
const noteImageMissing = '첨부한 기기에서만 볼 수 있는 사진';
const noteImageLimit = 20 * 1024 * 1024;

export function validNoteImageId(id) {
  return typeof id === 'string' && noteImageIdPattern.test(id);
}

export function noteImageWidth(value) {
  const width = Number(value);
  return Number.isInteger(width) && width >= 1 && width <= 8192 ? width : null;
}

export function encodeNoteImages(runs) {
  return runs.map(run => {
    if (run.block === 'toggle') {
      return { ...run, summary: encodeNoteImages(run.summary), children: encodeNoteImages(run.children) };
    }
    if (!run.imageId) return run;
    const { imageId, imageWidth, ...stored } = run;
    // Older installations can still read and edit the surrounding note.
    return { ...stored, text: '[사진:' + imageId + (imageWidth ? ':' + imageWidth : '') + ']' };
  });
}

export function decodeNoteImages(runs) {
  return runs.flatMap(run => {
    if (run.block === 'toggle') {
      return [{ ...run, summary: decodeNoteImages(run.summary), children: decodeNoteImages(run.children) }];
    }
    if (run.url) return [run];
    const tokens = [...run.text.matchAll(/\[사진:([0-9a-f-]{36})(?::(\d{1,4}))?\]/g)]
      .filter(match => validNoteImageId(match[1]));
    if (!tokens.length) return [run];
    const decoded = [];
    let offset = 0;
    for (const match of tokens) {
      if (match.index > offset) decoded.push({ ...run, text: run.text.slice(offset, match.index) });
      const imageWidth = noteImageWidth(match[2]);
      decoded.push({ ...run, text: '', imageId: match[1], ...(imageWidth ? { imageWidth } : {}) });
      offset = match.index + match[0].length;
    }
    if (offset < run.text.length) decoded.push({ ...run, text: run.text.slice(offset) });
    return decoded;
  });
}

export function noteImageMarkup(id, requestedWidth) {
  const width = noteImageWidth(requestedWidth);
  const size = width ? ' data-note-image-width="' + width + '" style="--note-image-width:' + width + 'px"' : '';
  return '<button type="button" class="notes-image" contenteditable="false" role="img" aria-label="' +
    noteImageMissing + '" tabindex="0" data-note-image-id="' + id + '"' + size + '></button>';
}

// A note that ends with a block image has no caret position below it, so Blink
// moves typing to the first line. A marked placeholder <br> gives one without
// adding a blank line to the saved note (readNoteEditor skips it).
export function ensureNoteImageCaret(editor) {
  const images = editor.querySelectorAll(noteImageSelector);
  const last = images[images.length - 1];
  if (!last) return;
  for (let node = last; node && node !== editor; node = node.parentNode) {
    let next = node.nextSibling;
    while (next && next.nodeType === 3 && !next.data) next = next.nextSibling;
    if (next) return;
  }
  const caret = document.createElement('br');
  caret.setAttribute('data-note-image-caret', '');
  last.after(caret);
}

export function observeNoteImages(editor) {
  const loadedNodes = new WeakSet();

  async function load(node) {
    if (loadedNodes.has(node)) return;
    loadedNodes.add(node);
    const id = node.getAttribute('data-note-image-id');
    if (!validNoteImageId(id)) return;
    try {
      const image = await window.electronAPI?.readNoteImage?.(id);
      if (!image?.ok || !editor.contains(node)) return;
      const preview = document.createElement('img');
      preview.alt = '';
      preview.draggable = false;
      preview.src = image.src;
      await preview.decode();
      if (!editor.contains(node)) return;
      const handle = document.createElement('span');
      handle.className = 'notes-image-resize';
      handle.setAttribute('aria-hidden', 'true');
      handle.title = '드래그하여 사진 크기 조절';
      node.replaceChildren(preview, handle);
      node.dataset.noteImageReady = 'true';
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', '메모 사진 원본 크기로 보기');
    } catch {
      // Keep the placeholder when this PC cannot display the stored image.
    } finally {
      if (!editor.contains(node)) loadedNodes.delete(node);
    }
  }

  function scan() {
    editor.querySelectorAll(noteImageSelector).forEach(load);
    ensureNoteImageCaret(editor);
  }

  const observer = new MutationObserver(scan);
  observer.observe(editor, { childList: true, subtree: true });
  scan();
  return () => observer.disconnect();
}

export function noteImageFiles(transfer) {
  return Array.from(transfer.files).filter(file => file.type.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name));
}

export function noteFileDrag(transfer) {
  return Array.from(transfer.types).includes('Files');
}

export async function attachNoteImages(editor, files, range, restoreSelection, save, notify) {
  const api = window.electronAPI;
  if (!api?.saveNoteImage) {
    notify('Windows 앱에서 사진을 첨부할 수 있어요.');
    return;
  }
  const ids = [];
  const errors = new Set();
  for (const file of files) {
    if (!editor.isConnected || editor.contentEditable !== 'true') return;
    if (file.size > noteImageLimit) {
      errors.add('사진 한 장은 20MB까지 첨부할 수 있어요.');
      continue;
    }
    try {
      const result = await api.saveNoteImage(await file.arrayBuffer());
      if (result?.ok && validNoteImageId(result.id)) ids.push(result.id);
      else if (result?.code === 'format') errors.add('PNG, JPEG, GIF, WebP, BMP 사진을 첨부할 수 있어요.');
      else if (result?.code === 'size') errors.add('사진 한 장은 20MB까지 첨부할 수 있어요.');
      else errors.add('사진을 이 PC에 저장하지 못했어요.');
    } catch {
      errors.add('사진을 이 PC에 저장하지 못했어요.');
    }
  }
  if (!editor.isConnected || editor.contentEditable !== 'true') return;
  if (ids.length && !editor.contains(range.commonAncestorContainer)) {
    notify('사진을 넣을 위치가 바뀌었어요. 사진을 다시 첨부해 주세요.');
    return;
  }
  if (ids.length) {
    const selection = document.getSelection();
    const previousFocus = document.activeElement;
    const previousRange = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const keepCaret = previousFocus !== editor || previousRange &&
      (range.compareBoundaryPoints(Range.START_TO_START, previousRange) !== 0 ||
       range.compareBoundaryPoints(Range.END_TO_END, previousRange) !== 0);
    restoreSelection(range);
    document.execCommand('insertHTML', false, ids.map(id => noteImageMarkup(id)).join(''));
    const last = editor.querySelector('[data-note-image-id="' + ids.at(-1) + '"]');
    // Blink needs an editable position after a trailing noneditable image.
    if (last && !last.nextSibling) {
      const lineBreak = document.createElement('br');
      lineBreak.setAttribute('data-note-image-caret', '');
      last.after(lineBreak);
      if (!keepCaret) {
        const caret = document.createRange();
        caret.setStartBefore(lineBreak);
        caret.collapse(true);
        restoreSelection(caret);
      }
    }
    if (previousFocus && previousFocus !== editor) previousFocus.focus({ preventScroll: true });
    if (keepCaret && previousRange) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
    if (!last) errors.add('메모에 사진을 넣지 못했어요.');
    else if (!save()) return;
  }
  notify([...errors].join(' '));
}

export function resizeNoteImage(event, editor, commit) {
  const handle = event.target.closest?.('.notes-image-resize');
  if (!handle || event.button !== 0 || !event.isPrimary) return;
  const image = handle.closest(noteImageSelector);
  const doc = image.ownerDocument;
  const win = doc.defaultView;
  const pointer = event.pointerId;
  const startX = event.clientX;
  const start = image.getBoundingClientRect();
  const right = editor.getBoundingClientRect().left + editor.clientLeft + editor.clientWidth;
  const available = Math.floor(right - start.left - parseFloat(getComputedStyle(editor).paddingRight));
  const maxWidth = Math.max(1, Math.min(8192, available));
  const minWidth = Math.min(48, Math.round(start.width), maxWidth);
  const originalStyle = image.style.getPropertyValue('--note-image-width');
  const widthAt = x => Math.min(maxWidth, Math.max(minWidth, Math.round(start.width + x - startX)));

  event.preventDefault();
  handle.setPointerCapture(pointer);
  image.classList.add('is-resizing');
  image.addEventListener('click', blockClick, true);

  function blockClick(click) {
    click.preventDefault();
    click.stopPropagation();
  }

  function move(next) {
    if (next.pointerId !== pointer) return;
    if (next.buttons & 1) image.style.setProperty('--note-image-width', widthAt(next.clientX) + 'px');
    else cleanup();
  }

  function cleanup() {
    doc.removeEventListener('pointermove', move, true);
    doc.removeEventListener('pointerup', finish, true);
    doc.removeEventListener('pointercancel', finish, true);
    win.removeEventListener('blur', cleanup);
    if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
    image.classList.remove('is-resizing');
    if (originalStyle) image.style.setProperty('--note-image-width', originalStyle);
    else image.style.removeProperty('--note-image-width');
    setTimeout(() => image.removeEventListener('click', blockClick, true), 0);
  }

  function finish(next) {
    if (next.pointerId !== pointer) return;
    cleanup();
    const width = widthAt(next.clientX);
    if (next.type === 'pointerup' && next.clientX !== startX && width !== Math.round(start.width) && editor.contains(image)) {
      commit(image, width);
    }
  }

  doc.addEventListener('pointermove', move, true);
  doc.addEventListener('pointerup', finish, true);
  doc.addEventListener('pointercancel', finish, true);
  win.addEventListener('blur', cleanup);
}

export function openNoteImage(node) {
  const source = node?.querySelector('img');
  if (!source) return false;
  const dialog = document.createElement('dialog');
  dialog.className = 'notes-image-dialog';
  dialog.setAttribute('aria-label', '메모 사진 보기');
  dialog.style.setProperty('--note-viewer-width', Math.max(400, source.naturalWidth + 32) + 'px');
  dialog.style.setProperty('--note-viewer-height', Math.max(220, source.naturalHeight + 72) + 'px');

  const toolbar = document.createElement('div');
  toolbar.className = 'notes-image-viewer-toolbar';
  const viewport = document.createElement('div');
  viewport.className = 'notes-image-viewport';
  const image = source.cloneNode();
  image.alt = noteImageAlt;
  viewport.append(image);
  const percent = document.createElement('output');
  percent.className = 'notes-image-zoom';
  let zoom = 1;

  function button(text, label, action) {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = text;
    control.setAttribute('aria-label', label);
    control.addEventListener('click', action);
    return control;
  }

  function setZoom(scale) {
    zoom = Math.max(0.01, Math.min(4, scale));
    image.style.width = Math.max(1, Math.round(source.naturalWidth * zoom)) + 'px';
    percent.textContent = Math.round(zoom * 100) + '%';
  }

  const close = button('닫기', '사진 팝업 닫기', () => dialog.close());
  close.className = 'notes-image-viewer-close';
  close.autofocus = true;
  toolbar.append(
    button('−', '축소', () => setZoom(zoom / 1.25)),
    percent,
    button('+', '확대', () => setZoom(zoom * 1.25)),
    button('맞춤', '화면에 맞춤', () => {
      const bounds = viewport.getBoundingClientRect();
      setZoom(Math.min(1, (bounds.width - 24) / source.naturalWidth, (bounds.height - 24) / source.naturalHeight));
      viewport.scrollTo(0, 0);
    }),
    button('원본', '원본 크기', () => setZoom(1)),
    close
  );
  dialog.append(toolbar, viewport);
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (node.isConnected) node.focus({ preventScroll: true });
  }, { once: true });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  setZoom(1);
  dialog.showModal();
  return true;
}
