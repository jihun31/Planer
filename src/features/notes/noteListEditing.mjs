import { MAX_NOTE_LIST_DEPTH } from './noteRichText.mjs';
import { noteFormatAt } from './noteEditorDom.mjs';
import { changeNoteChecklistDepth, repairNoteChecklists } from './noteChecklistEditing.mjs';

// Handle empty items before Chromium's native paragraph command can create
// another nested item. Each Enter exits exactly one list level.
export function editNoteListKey(editor,selection,key) {
  if (!selection?.rangeCount||!selection.isCollapsed) return false;
  const range=selection.getRangeAt(0);
  if(!editor.contains(range.commonAncestorContainer)) return false;
  const element=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  const item=element?.closest('li');
  if(!item||!editor.contains(item)||!['UL','OL'].includes(item.parentElement?.nodeName)) return false;
  const own=item.cloneNode(true);
  own.querySelectorAll('ul,ol,[data-note-checkbox]').forEach(node=>node.remove());
  const empty=!own.textContent.replace(/[\u200b\ufeff]/g,'').trim()&&!own.querySelector('a,img,hr,details');
  if(key==='Enter'&&!empty) return false;
  if(key==='Backspace') {
    if(item.hasAttribute('data-note-checked')&&!empty) return false;
    const before=range.cloneRange();before.selectNodeContents(item);before.setEnd(range.startContainer,range.startOffset);
    if(before.toString().replace(/[\u200b\ufeff]/g,'').length) return false;
  }else if(key!=='Enter') return false;
  const doc=editor.ownerDocument,list=item.parentElement,parent=list.parentElement,tail=list.cloneNode(false);
  while(item.nextSibling) tail.append(item.nextSibling);
  let target;
  if(parent.nodeName==='LI') {
    parent.after(item);if(tail.childNodes.length)item.append(tail);
    target=item.querySelector(':scope > .notes-checklist-text')||item;
  }else{
    const paragraph=doc.createElement('div');
    const content=item.querySelector(':scope > .notes-checklist-text');
    if(content)paragraph.append(...content.childNodes);
    else for(const child of [...item.childNodes])if(!['UL','OL'].includes(child.nodeName))paragraph.append(child);
    if(!paragraph.childNodes.length)paragraph.append(doc.createElement('br'));
    list.after(paragraph);
    let last=paragraph;
    for(const nested of [...item.children].filter(node=>['UL','OL'].includes(node.nodeName))){last.after(nested);last=nested;}
    if(tail.childNodes.length)last.after(tail);
    item.remove();target=paragraph;
  }
  if(!list.children.length)list.remove();
  const caret=doc.createRange();caret.selectNodeContents(target);caret.collapse(true);
  selection.removeAllRanges();selection.addRange(caret);
  return true;
}

export function changeNoteListDepth(editor,selection,outdent = false) {
  if (!selection?.rangeCount) return false;
  const range=selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;
  const element=range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const item=element?.closest('li');
  if (!item || !editor.contains(item)) return false;
  if (item.hasAttribute('data-note-checked')) return changeNoteChecklistDepth(editor,selection,outdent);
  if(!outdent&&!item.previousElementSibling&&(noteFormatAt(item,editor).listDepth||0)<MAX_NOTE_LIST_DEPTH&&nestUnderPreviousList(editor,item,range,selection))return true;
  if (!outdent && (!item.previousElementSibling || (noteFormatAt(item,editor).listDepth || 0) >= MAX_NOTE_LIST_DEPTH)) return true;
  editor.ownerDocument.execCommand(outdent ? 'outdent' : 'indent');
  // Chromium creates list-inside-list on indent and LI-inside-LI on outdent.
  // Repair both shapes so saving and reopening produces the same document.
  const active=selection.rangeCount ? selection.getRangeAt(0) : null;
  const endpoints=active && [active.startContainer,active.startOffset,active.endContainer,active.endOffset];
  let repaired=false;
  for (const list of editor.querySelectorAll('ul > ul, ul > ol, ol > ul, ol > ol')) {
    const parent=list.previousElementSibling;
    if (parent?.nodeName !== 'LI') continue;
    parent.append(list);repaired=true;
  }
  for (const child of [...editor.querySelectorAll('li > li')].reverse()) {
    const parent=child.parentElement,list=parent.parentElement;
    if (!['UL','OL'].includes(list?.nodeName)) continue;
    list.insertBefore(child,parent.nextSibling);repaired=true;
  }
  repaired=repairNoteChecklists(editor)||repaired;
  if (repaired && endpoints && editor.contains(endpoints[0]) && editor.contains(endpoints[2])) {
    const restored=editor.ownerDocument.createRange();
    const limit=node=>node.nodeType === 3 ? node.length : node.childNodes.length;
    restored.setStart(endpoints[0],Math.min(endpoints[1],limit(endpoints[0])));
    restored.setEnd(endpoints[2],Math.min(endpoints[3],limit(endpoints[2])));
    selection.removeAllRanges();selection.addRange(restored);
  }
  return true;
}

function nestUnderPreviousList(editor,item,range,selection) {
  const list=item.parentElement;
  if(!list.contains(range.endContainer))return false;
  let wrapper=list;
  while(!wrapper.previousElementSibling&&wrapper.parentElement!==editor){
    const parent=wrapper.parentElement;
    if(parent?.nodeName!=='DIV'||parent.classList.contains('notes-toggle-body')||parent.children.length!==1||parent.textContent!==wrapper.textContent)return false;
    wrapper=parent;
  }
  let previous=wrapper.previousElementSibling;
  while(previous?.nodeName==='DIV'&&!previous.classList.contains('notes-toggle-body')&&previous.children.length===1&&previous.textContent===previous.firstElementChild.textContent)previous=previous.firstElementChild;
  if(!['UL','OL'].includes(previous?.nodeName))return false;
  const parentItem=previous.lastElementChild;
  if(parentItem?.nodeName!=='LI')return false;
  const endpoints=[range.startContainer,range.startOffset,range.endContainer,range.endOffset],oldParent=list.parentElement;
  const nested=parentItem.lastElementChild;
  if(nested?.nodeName===list.nodeName){nested.append(...list.childNodes);list.remove();}
  else parentItem.append(list);
  let empty=oldParent;
  while(empty!==editor&&empty.nodeName==='DIV'&&!empty.childNodes.length&&!empty.classList.contains('notes-toggle-body')){
    const parent=empty.parentElement;empty.remove();empty=parent;
  }
  if(editor.contains(endpoints[0])&&editor.contains(endpoints[2])){
    const restored=editor.ownerDocument.createRange();
    const limit=node=>node.nodeType===3?node.length:node.childNodes.length;
    restored.setStart(endpoints[0],Math.min(endpoints[1],limit(endpoints[0])));restored.setEnd(endpoints[2],Math.min(endpoints[3],limit(endpoints[2])));
    selection.removeAllRanges();selection.addRange(restored);
  }
  return true;
}
