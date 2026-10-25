import { createNoteToggle, noteHtml, serializeNoteRuns } from './noteRichText.mjs';
import { readNoteEditor } from './noteEditorDom.mjs';
import { MAX_NOTE_LENGTH } from './notepadStore.mjs';

export function insertNextNoteToggle(editor,details) {
  if (!details || !editor.contains(details)) return false;
  const doc=editor.ownerDocument, clone=editor.cloneNode(true), path=[];
  for (let node=details;node!==editor;node=node.parentNode) path.unshift([...node.parentNode.childNodes].indexOf(node));
  const current=path.reduce((node,index)=>node.childNodes[index],clone);
  const toggle=createNoteToggle([]);toggle.open=false;
  const template=doc.createElement('template');template.innerHTML=noteHtml(serializeNoteRuns([toggle]),true);
  const next=template.content.firstElementChild;next.setAttribute('data-new-note-toggle','');
  current.after(next);
  if (readNoteEditor(clone).length > MAX_NOTE_LENGTH) return false;
  details.after(next);
  next.removeAttribute('data-new-note-toggle');
  editor.focus({preventScroll:true});
  const selection=doc.getSelection();
  const inserted=next;
  const title=inserted.querySelector('.notes-toggle-title');
  const caret=doc.createRange();caret.selectNodeContents(title);caret.collapse(true);
  selection.removeAllRanges();selection.addRange(caret);
  return true;
}
