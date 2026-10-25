function selectedItems(editor, selection) {
  if (!selection?.rangeCount) return [];
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return [];
  if (range.collapsed) {
    const element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const item = element?.closest('li');
    return item && editor.contains(item) ? [item] : [];
  }
  return [...editor.querySelectorAll('li')].filter(item => range.intersectsNode(item));
}

function keepSelection(editor, selection, change) {
  const range = selection.getRangeAt(0);
  const endpoints = [range.startContainer, range.startOffset, range.endContainer, range.endOffset];
  if (change() === false) return;
  if (editor.contains(endpoints[0]) && editor.contains(endpoints[2])) {
    const next = editor.ownerDocument.createRange();
    const limit=node=>node.nodeType===3?node.length:node.childNodes.length;
    next.setStart(endpoints[0], Math.min(endpoints[1],limit(endpoints[0])));next.setEnd(endpoints[2], Math.min(endpoints[3],limit(endpoints[2])));
    selection.removeAllRanges();selection.addRange(next);
  }
}

function createCheckbox(doc, checked=false) {
  const button=doc.createElement('button');
  button.type='button';button.className='notes-checkbox';button.contentEditable='false';
  button.setAttribute('data-note-checkbox','true');button.setAttribute('role','checkbox');
  button.setAttribute('aria-label','체크리스트 완료');button.setAttribute('aria-checked',String(checked));
  return button;
}

function ensureCaretSlot(content) {
  if (!content.textContent && !content.querySelector('br,a,img')) content.replaceChildren(content.ownerDocument.createElement('br'));
}

function decorateItem(item) {
  if (item.hasAttribute('data-note-checked')) return;
  const doc = item.ownerDocument, content = doc.createElement('span'), button = createCheckbox(doc);
  content.className = 'notes-checklist-text';
  for (const child of [...item.childNodes]) if (!['UL','OL'].includes(child.nodeName)) content.append(child);
  ensureCaretSlot(content);
  item.classList.add('notes-checklist-item');item.setAttribute('data-note-checked','false');
  item.prepend(button,content);
}

export function applyNoteChecklist(editor, selection) {
  if (!selection?.rangeCount || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) return false;
  if (!selectedItems(editor,selection).length) {
    editor.ownerDocument.execCommand('formatBlock',false,'div');
    editor.ownerDocument.execCommand('insertUnorderedList');
  }
  const items = selectedItems(editor,selection);
  keepSelection(editor,selection,() => items.forEach(decorateItem));
  if (selection.isCollapsed && items.length === 1) {
    const content=items[0].querySelector(':scope > .notes-checklist-text');
    if (content && !content.contains(selection.getRangeAt(0).startContainer)) placeCaret(editor,content);
  }
  return items.length > 0;
}

// Chromium can replace LI elements during indent/outdent while retaining their
// inline children. Restore the item's checkbox metadata and editable text span.
export function repairNoteChecklists(editor) {
  let repaired=false;
  const selection=editor.ownerDocument.getSelection();
  const repair=()=>{
    for (const item of [...editor.querySelectorAll('li')].reverse()) {
      let button=item.querySelector(':scope > [data-note-checkbox]');
      if (!button&&!item.hasAttribute('data-note-checked')) continue;
      const existing=item.querySelector(':scope > .notes-checklist-text');
      // A native multi-line deletion can retain the last LI while deleting its
      // checkbox. Drop that empty shell, rather than restoring a ghost item.
      if (!button&&!item.textContent&&!item.querySelector('li,a,img')) {
        const list=item.parentElement, active=selection?.isCollapsed&&item.contains(selection.anchorNode);
        const neighbour=item.previousElementSibling||item.nextElementSibling;
        item.remove();repaired=true;
        if (!list.children.length) {
          const paragraph=editor.ownerDocument.createElement('div');paragraph.append(editor.ownerDocument.createElement('br'));
          list.replaceWith(paragraph);if(active) placeCaret(editor,paragraph);
        } else if(active) placeCaret(editor,neighbour?.querySelector(':scope > .notes-checklist-text')||neighbour||list);
        continue;
      }
      const missingButton=!button;
      if (!button) button=createCheckbox(editor.ownerDocument,item.getAttribute('data-note-checked')==='true');
      const outside=[...item.childNodes].filter(child=>child!==button&&child!==existing&&!['UL','OL'].includes(child.nodeName));
      const checked=button.getAttribute('aria-checked') === 'true' ? 'true' : 'false';
      if (existing&&!missingButton&&!outside.length&&item.classList.contains('notes-checklist-item')&&item.getAttribute('data-note-checked')===checked) {
        if(!existing.textContent&&!existing.querySelector('br,a,img')) {ensureCaretSlot(existing);repaired=true;}
        continue;
      }
      const content=existing || editor.ownerDocument.createElement('span');
      const fragment=editor.ownerDocument.createDocumentFragment();
      for (const child of [...item.childNodes]) {
        if (child === button || ['UL','OL'].includes(child.nodeName)) continue;
        if (child === content) fragment.append(...content.childNodes);
        else fragment.append(child);
      }
      content.className='notes-checklist-text';content.replaceChildren(fragment);
      ensureCaretSlot(content);
      item.classList.add('notes-checklist-item');item.setAttribute('data-note-checked',checked);
      item.prepend(button,content);repaired=true;
    }
  };
  if(selection?.rangeCount&&editor.contains(selection.getRangeAt(0).commonAncestorContainer)) keepSelection(editor,selection,()=>{repair();return repaired;});
  else repair();
  normalizeNoteChecklistCaret(editor,selection);
  return repaired;
}

function normalizeNoteChecklistCaret(editor,selection) {
  if (!selection?.isCollapsed||!selection.rangeCount) return;
  const range=selection.getRangeAt(0), node=range.startContainer;
  const element=node.nodeType===1?node:node.parentElement;
  const item=element?.closest('li[data-note-checked]');
  if (!item||!editor.contains(item)) return;
  const content=item.querySelector(':scope > .notes-checklist-text');
  if (!content||content.contains(node)) return;
  const afterContent=node===item&&range.startOffset>[...item.childNodes].indexOf(content);
  placeCaret(editor,content,afterContent);
}

export function changeNoteChecklistDepth(editor, selection, outdent) {
  const items=selectedItems(editor,selection);
  const first=items[0];
  if (!first?.hasAttribute('data-note-checked')) return false;
  const list=first.parentElement, siblings=items.filter(item=>item.parentElement===list);
  if (outdent) {
    const parent=list.parentElement;
    if (parent.nodeName !== 'LI') {
      if (siblings.length === 1) leaveItem(editor,first,first.querySelector(':scope > .notes-checklist-text'));
      return true;
    }
    keepSelection(editor,selection,()=>{
      const tail=list.cloneNode(false);
      while(siblings.at(-1).nextSibling) tail.append(siblings.at(-1).nextSibling);
      parent.after(...siblings);
      if(tail.childNodes.length) siblings.at(-1).append(tail);
      if(!list.childNodes.length) list.remove();
    });
  } else {
    const previous=first.previousElementSibling;
    let depth=0;
    for(let node=list;node && node!==editor;node=node.parentElement) if(['UL','OL'].includes(node.nodeName)) depth++;
    if(previous?.nodeName !== 'LI' || depth>8) return true;
    keepSelection(editor,selection,()=>{
      let nested=previous.querySelector(':scope > ul,:scope > ol');
      if(!nested){nested=editor.ownerDocument.createElement('ul');previous.append(nested);}
      nested.append(...siblings);
    });
  }
  return true;
}

export function clearNoteChecklists(editor, selection) {
  const items = selectedItems(editor,selection).filter(item => item.hasAttribute('data-note-checked'));
  if (!items.length) return;
  keepSelection(editor,selection,() => {
    for (const item of items) {
      item.removeAttribute('data-note-checked');item.classList.remove('notes-checklist-item');
      item.querySelector(':scope > [data-note-checkbox]')?.remove();
      const content = item.querySelector(':scope > .notes-checklist-text');
      if (content) content.replaceWith(...content.childNodes);
    }
  });
}

export function toggleNoteChecklist(item) {
  const checked = item.getAttribute('data-note-checked') !== 'true';
  item.setAttribute('data-note-checked',String(checked));
  item.querySelector(':scope > [data-note-checkbox]')?.setAttribute('aria-checked',String(checked));
}

function placeCaret(editor, node, end=false) {
  if(node.classList?.contains('notes-checklist-text')) ensureCaretSlot(node);
  const range = editor.ownerDocument.createRange();range.selectNodeContents(node);range.collapse(!end);
  const selection = editor.ownerDocument.getSelection();selection.removeAllRanges();selection.addRange(range);
}

function leaveItem(editor, item, content) {
  const doc = editor.ownerDocument, list = item.parentElement, paragraph = doc.createElement('div'), tail = list.cloneNode(false);
  paragraph.append(...content.childNodes);
  if (!paragraph.childNodes.length) paragraph.append(doc.createElement('br'));
  while (item.nextSibling) tail.append(item.nextSibling);
  list.after(paragraph);
  // Retain nested and following items when leaving a checklist in the middle.
  for (const child of [...item.children]) if (['UL','OL'].includes(child.nodeName)) paragraph.after(child);
  if (tail.childNodes.length) paragraph.after(tail);
  item.remove();if (!list.childNodes.length) list.remove();
  placeCaret(editor,paragraph);
}

export function editNoteChecklistKey(editor, selection, key) {
  if (!selection?.rangeCount) return false;
  repairNoteChecklists(editor);
  const range = selection.getRangeAt(0), element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const item = element?.closest('li[data-note-checked]'), content = item?.querySelector(':scope > .notes-checklist-text');
  if (!content || !editor.contains(item) || !content.contains(range.commonAncestorContainer)) return false;
  if (key === 'Backspace') {
    if (!range.collapsed) return false;
    const before = range.cloneRange();before.selectNodeContents(content);before.setEnd(range.startContainer,range.startOffset);
    if (before.toString()) return false;
    leaveItem(editor,item,content);return true;
  }
  if (key !== 'Enter') return false;
  if (!content.textContent.trim() && !item.querySelector('ul,ol')) {
    leaveItem(editor,item,content);return true;
  }
  range.deleteContents();
  const remainder = range.cloneRange();remainder.setEnd(content,content.childNodes.length);
  const next = editor.ownerDocument.createElement('li');next.append(remainder.extractContents());
  decorateItem(next);item.after(next);
  if (!content.textContent && !content.querySelector('a')) content.replaceChildren(editor.ownerDocument.createElement('br'));
  placeCaret(editor,next.querySelector('.notes-checklist-text'));
  return true;
}
