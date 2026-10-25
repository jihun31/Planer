import { MAX_NOTE_LIST_DEPTH } from './noteRichText.mjs';
import { noteFormatAt } from './noteEditorDom.mjs';
import { changeNoteChecklistDepth, repairNoteChecklists } from './noteChecklistEditing.mjs';

export function changeNoteListDepth(editor,selection,outdent = false) {
  if (!selection?.rangeCount) return false;
  const range=selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;
  const element=range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const item=element?.closest('li');
  if (!item || !editor.contains(item)) return false;
  if (item.hasAttribute('data-note-checked')) return changeNoteChecklistDepth(editor,selection,outdent);
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
