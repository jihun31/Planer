import { noteFormatAt, readNoteEditor } from './noteEditorDom.mjs';
import { noteHtml, notePlainText } from './noteRichText.mjs';

export function startNoteTextDrag(editor,event) {
  const selection = editor.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) {event.preventDefault();return null;}
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {event.preventDefault();return null;}
  const text = readNoteEditor(range.cloneContents(),noteFormatAt(range.commonAncestorContainer,editor));
  event.dataTransfer.setData('application/x-planer-note',text);
  event.dataTransfer.setData('text/plain',notePlainText(text));
  event.dataTransfer.setData('text/html',noteHtml(text).replace(/\n/g,'<br>'));
  event.dataTransfer.effectAllowed = 'move';
  return {range:range.cloneRange(),editor,text};
}

export function noteTextDropRange(editor,drag,event) {
  if (!drag || drag.editor !== editor || !editor.contains(drag.range.commonAncestorContainer)) return null;
  const doc = editor.ownerDocument;
  let range = doc.caretRangeFromPoint?.(event.clientX,event.clientY);
  if (!range && doc.caretPositionFromPoint) {
    const point = doc.caretPositionFromPoint(event.clientX,event.clientY);
    if (point) {range=doc.createRange();range.setStart(point.offsetNode,point.offset);range.collapse(true);}
  }
  const hit = doc.elementFromPoint?.(event.clientX,event.clientY) || event.target;
  const header = hit?.closest?.('summary');
  const toggle = header?.parentElement;
  if (toggle?.matches?.('details.notes-toggle') && editor.contains(toggle)) {
    const body=[...toggle.children].find(child=>child.classList.contains('notes-toggle-body'));
    if (!body) return null;
    range=doc.createRange();range.selectNodeContents(body);range.collapse(false);
    range.noteDropToggle={toggle,body,header};
    return drag.range.comparePoint(range.startContainer,range.startOffset) !== 0 ? range : null;
  }
  const body = hit?.closest?.('.notes-toggle-body');
  if (body && editor.contains(body) && (!range || !body.contains(range.startContainer))) {
    const line=body.lastElementChild || body;
    range=doc.createRange();range.selectNodeContents(line);range.collapse(!line.textContent);
  }
  if (!range || !editor.contains(range.startContainer)) return null;
  const element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  if (element?.closest('[contenteditable="false"]')) return null;
  const line = element?.closest?.('p,h1,h2,h3,blockquote,li,div');
  if (line?.textContent && line !== editor && !line.classList.contains('notes-toggle-body') && !line.closest('summary')) {
    const rect=line.getBoundingClientRect();
    const edge=Math.min(6,rect.height / 4);
    if (event.clientY <= rect.top + edge || event.clientY >= rect.bottom - edge) {
      range=doc.createRange();
      if (event.clientY <= rect.top + edge) range.setStartBefore(line);
      else range.setStartAfter(line);
      range.collapse(true);
      range.noteDropLine={line,after:event.clientY > rect.top + edge};
    }
  }
  // Dropping inside the source or into a nested part of that source must be a no-op.
  return drag.range.comparePoint(range.startContainer,range.startOffset) !== 0 ? range : null;
}

export function noteTextDropAllowed(editor,drag,event) {
  return !!noteTextDropRange(editor,drag,event);
}

export function noteTextDropIndicator(editor,drag,event) {
  const range=noteTextDropRange(editor,drag,event);
  if (!range) return null;
  const bounds=editor.getBoundingClientRect();
  if (range.noteDropToggle) {
    const header=range.noteDropToggle.header.getBoundingClientRect();
    const left=Math.max(bounds.left,header.left+21), right=Math.min(bounds.right,header.right);
    return header.bottom >= bounds.top && header.bottom <= bounds.bottom
      ? {left,top:header.bottom-1.5,width:Math.max(0,right-left),height:3} : null;
  }
  const element=range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const container=element?.closest?.('.notes-toggle-body') || editor;
  const area=container.getBoundingClientRect();
  const view=editor.ownerDocument.defaultView;
  const padding=view.getComputedStyle(container);
  const left=Math.max(bounds.left,area.left + (parseFloat(padding.paddingLeft) || 0));
  const right=Math.min(bounds.right,area.right - (parseFloat(padding.paddingRight) || 0));
  const line=range.noteDropLine;
  if (line) {
    const rect=line.line.getBoundingClientRect(), top=line.after ? rect.bottom : rect.top;
    if (top < bounds.top || top > bounds.bottom) return null;
    return {left,top:top - 1.5,width:Math.max(0,right-left),height:3};
  }
  const rect=range.getBoundingClientRect();
  const row=element?.closest?.('p,h1,h2,h3,blockquote,li,div,summary') || element;
  const empty=row && !row.textContent;
  if (empty) {
    const box=row.getBoundingClientRect(), top=Math.max(bounds.top,box.top);
    return top <= bounds.bottom ? {left,top,width:Math.max(0,right-left),height:3} : null;
  }
  if (!rect.height || rect.bottom < bounds.top || rect.top > bounds.bottom) return null;
  return {left:Math.max(bounds.left,Math.min(rect.left,bounds.right-2)),top:Math.max(bounds.top,rect.top),
    width:2,height:Math.min(rect.bottom,bounds.bottom)-Math.max(rect.top,bounds.top)};
}

export function prepareNoteTextMove(editor,drag,event) {
  const destination = noteTextDropRange(editor,drag,event);
  if (!destination) return null;
  const doc=editor.ownerDocument, clone=editor.cloneNode(true);
  function clonedNode(node) {
    const path=[];
    while (node !== editor) {
      path.unshift([...node.parentNode.childNodes].indexOf(node));node=node.parentNode;
    }
    return path.reduce((parent,index)=>parent.childNodes[index],clone);
  }
  const source=doc.createRange(), target=doc.createRange();
  const dropToggle=destination.noteDropToggle;
  const toggleClone=dropToggle ? clonedNode(dropToggle.toggle) : null;
  const bodyClone=dropToggle ? clonedNode(dropToggle.body) : null;
  source.setStart(clonedNode(drag.range.startContainer),drag.range.startOffset);
  source.setEnd(clonedNode(drag.range.endContainer),drag.range.endOffset);
  target.setStart(clonedNode(destination.startContainer),destination.startOffset);target.collapse(true);
  source.deleteContents();
  if (toggleClone) {
    toggleClone.open=true;
    if (!bodyClone.textContent && !bodyClone.querySelector('details,hr,a,img')) {
      bodyClone.replaceChildren();target.setStart(bodyClone,0);target.collapse(true);
    }
  }
  const emptyLine=target.startContainer;
  if (emptyLine.nodeType === 1 && emptyLine.childNodes.length === 1 && emptyLine.firstChild.nodeName === 'BR') {
    emptyLine.firstChild.remove();
  }
  const fragment=target.createContextualFragment(noteHtml(drag.text,!!dropToggle));
  const marker=doc.createElement('span');marker.setAttribute('data-note-drop-caret','');
  const last=fragment.lastElementChild;
  if (dropToggle && last?.matches('div,p,h1,h2,h3,blockquote')) last.append(marker);
  else fragment.append(marker);
  target.insertNode(fragment);
  return {html:clone.innerHTML,text:readNoteEditor(clone),content:clone};
}

// Replacing an entire editable document with insertHTML lets Chromium split
// details elements and leave fragments of the previous document behind.
export function applyNoteTextMove(editor,moved) {
  if (!moved?.content || moved.content.ownerDocument !== editor.ownerDocument
    || readNoteEditor(moved.content) !== moved.text) return null;
  const doc=editor.ownerDocument;
  editor.replaceChildren(...moved.content.childNodes);
  editor.focus({preventScroll:true});
  const marker=editor.querySelector('[data-note-drop-caret]');
  const caret=doc.createRange();
  if (marker) {caret.setStartBefore(marker);caret.collapse(true);marker.remove();}
  else {caret.selectNodeContents(editor);caret.collapse(false);}
  const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(caret);
  return caret;
}
