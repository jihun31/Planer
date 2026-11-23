import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_NOTE_LENGTH } from '../../features/notes/notepadStore.mjs';
import { escapeHtml, linkHtml, loadYouTubeInfo, youtubeVideo } from '../../features/notes/youtubeLinks.mjs';
import { webLink, siteLinkHtml, loadSiteInfo } from '../../features/notes/siteLinks.mjs';
import { NOTE_BLOCKS, NOTE_HIGHLIGHT, NOTE_TEXT_COLORS, createNoteToggle, noteColor, noteHtml, noteRuns, serializeNoteRuns } from '../../features/notes/noteRichText.mjs';
import { firstEmptyNoteLine, noteFormatAt, noteInlineLinkSelector, noteLine, noteLineSelected, noteRangeHasContent, readNoteEditor, removeNoteLine, restoreNoteSelection, selectWholeNote } from '../../features/notes/noteEditorDom.mjs';
import { toggledNoteColor, rememberNoteColor } from '../../features/notes/noteEditorPreferences.mjs';
import { startNoteTextDrag, noteTextDropAllowed, noteTextDropIndicator, prepareNoteTextMove, applyNoteTextMove } from '../../features/notes/noteTextDrag.mjs';
import { insertNextNoteToggle } from '../../features/notes/noteToggleEditor.mjs';
import { noteSlashShortcut } from '../../features/notes/noteSlashCommands.mjs';
import { changeNoteListDepth, editNoteListKey } from '../../features/notes/noteListEditing.mjs';
import { applyNoteChecklist, clearNoteChecklists, editNoteChecklistKey, repairNoteChecklists, toggleNoteChecklist } from '../../features/notes/noteChecklistEditing.mjs';
import { convertNoteListItems, moveNoteListItemTo, moveNoteListItems, noteListDropTarget, noteListItemAtPoint, settleNoteChecklistItem } from '../../features/notes/noteListTools.mjs';
import { noteClipboardText, noteListFromPlainText } from '../../features/notes/noteListText.mjs';
import { attachNoteImages, noteFileDrag, noteImageFiles, noteImageSelector, observeNoteImages, openNoteImage, resizeNoteImage } from '../../features/notes/noteImages.mjs';

function selectedFormats() {
  const colors = ['hiliteColor','backColor'].map(command => document.queryCommandValue(command).replace(/\s/g,'').toLowerCase());
  return {bold:document.queryCommandState('bold'),italic:document.queryCommandState('italic'),
    underline:document.queryCommandState('underline'),
    strikeThrough:document.queryCommandState('strikeThrough'),
    color:noteColor(document.queryCommandValue('foreColor')) || NOTE_TEXT_COLORS[0].value,
    highlight:colors.some(color => [NOTE_HIGHLIGHT,'rgb(255,240,168)'].includes(color))};
}

function rangeAnchor(range,root) {
  let rect = range.getBoundingClientRect();
  if (!rect.height) rect = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.getBoundingClientRect() || root.getBoundingClientRect();
  return {left:rect.left,top:rect.top,bottom:rect.bottom};
}
const sameAnchor = (a,b) => a && b && a.left === b.left && a.top === b.top && a.bottom === b.bottom;
function popupPosition(anchor,height,width) {
  return {left:Math.max(8,Math.min(anchor.left,window.innerWidth - width - 8)),
    top:Math.max(8,anchor.top > height + 8 ? anchor.top - height - 8 : Math.min(anchor.bottom + 8,window.innerHeight - height - 8))};
}
const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
// '체크리스트' -> 'ㅊㅋㄹㅅㅌ', so '/ㅊㅋ' finds the checklist block.
const choseong = text => [...text].map(char => {
  const code = char.charCodeAt(0) - 0xac00;
  return code >= 0 && code < 11172 ? CHOSEONG[Math.floor(code / 588)] : char;
}).join('');
function slashOptions(query) {
  const search = query.replace(/\s/g,'').toLowerCase();
  return NOTE_BLOCKS.filter(block => {
    if (block.toolbarOnly) return false;
    const terms = block.search.replace(/\s/g,'').toLowerCase();
    return terms.includes(search) || choseong(terms).includes(search);
  });
}

function caretPoint(root,range) {
  const firstLine = root.firstElementChild;
  if (firstLine && range.endContainer === firstLine && range.endOffset === 0 &&
    firstLine.childNodes.length === 1 && firstLine.firstChild.nodeName === 'BR') return {firstLine:true};
  const element=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement;
  const item=element?.closest('li'),scope=item&&root.contains(item)?item:root;
  const before=range.cloneRange();before.selectNodeContents(scope);before.setEnd(range.endContainer,range.endOffset);
  return {item:scope===root?null:[...root.querySelectorAll('li')].indexOf(scope),offset:before.toString().length};
}

function restoreCaretPoint(root,point) {
  if (point.firstLine && root.firstElementChild) {
    root.ownerDocument.getSelection().collapse(root.firstElementChild,0);
    return;
  }
  const block=point.item===null?root:root.querySelectorAll('li')[point.item];
  if(!block)return;
  const scope=block.querySelector(':scope > .notes-checklist-text, :scope > [data-note-list-content]') || block;
  const nested=scope.nodeName==='LI' && scope.querySelector(':scope > ul, :scope > ol');
  const doc=root.ownerDocument,walker=doc.createTreeWalker(scope,4),range=doc.createRange();
  let remaining=point.offset,node,found=false;
  while((node=walker.nextNode()) && (!nested || !nested.contains(node))){
    if(remaining<=node.length){range.setStart(node,remaining);range.collapse(true);found=true;break;}
    remaining-=node.length;
  }
  if(!found){range.selectNodeContents(scope);if(nested)range.setEndBefore(nested);range.collapse(point.offset===0);}
  const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);
}

function autoNumberedUndo(root,range) {
  // Snapshot the typed space without letting it trigger another conversion.
  const clone=root.cloneNode(true),path=[];
  for(let node=range.endContainer;node!==root;node=node.parentNode)path.unshift([...node.parentNode.childNodes].indexOf(node));
  const end=path.reduce((node,index)=>node.childNodes[index],clone),caret=root.ownerDocument.createRange();
  caret.setStart(end,range.endOffset);caret.collapse(true);caret.insertNode(root.ownerDocument.createTextNode(' '));
  const point=caretPoint(root,range);point.offset++;
  return {before:readNoteEditor(clone),beforeCaret:point};
}

export function NoteTextEditor({text,edit,loading,readOnly,onFocusTitle,ref}) {
  const editor = useRef(null);
  const saved = useRef(null);
  const sequence = useRef(0);
  const selectionRange = useRef(null);
  const slashRange = useRef(null);
  const dismissedSlash = useRef(null);
  const composing = useRef(false);
  const popup = useRef(null);
  const textDrag = useRef(null);
  const toggleHistory = useRef({undo:[],redo:[]});
  const lineSelection = useRef(null);
  const caretLineCut = useRef(null);
  const imageWasSelected = useRef(false);
  const menuId = useId();
  const [formats,setFormats] = useState({bold:false,italic:false,underline:false,strikeThrough:false,highlight:false,color:NOTE_TEXT_COLORS[0].value});
  const [anchor,setAnchor] = useState(null);
  const [menu,setMenu] = useState(null);
  const [blockType,setBlockType] = useState('text');
  const [slash,setSlash] = useState(null);
  const [notice,setNotice] = useState('');
  const [dropIndicator,setDropIndicator] = useState(null);
  const [listHandle,setListHandle] = useState(null);
  const handleItem = useRef(null);
  const listDrag = useRef(null);
  useLayoutEffect(() => observeNoteImages(editor.current),[]);
  useLayoutEffect(() => {
    if (saved.current !== text) {
      textDrag.current = null;
      toggleHistory.current={undo:[],redo:[]};
      setDropIndicator(null);
      editor.current.innerHTML = text ? noteHtml(text,true) : '';
      saved.current = text;
      selectionRange.current = null;
      slashRange.current = null;
      setAnchor(null);setSlash(null);setMenu(null);
    }
  },[text]);
  const inspectSelection = useCallback(() => {
    if (textDrag.current) return;
    const root = editor.current, selection = window.getSelection();
    if (loading || readOnly || composing.current || !root || root.closest('[hidden]') || !selection?.rangeCount
      || !root.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      setAnchor(null);setSlash(null);setMenu(null);return;
    }
    const range = selection.getRangeAt(0).cloneRange();
    selectionRange.current = range;
    const next = selectedFormats();
    setFormats(previous => Object.keys(next).every(key => next[key] === previous[key]) ? previous : next);
    const element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const formatBlock = noteFormatAt(range.startContainer,root).block;
    setBlockType(element?.closest('.notes-toggle-title') ? 'toggle' : formatBlock === 'list-text' ? 'text' : formatBlock || 'text');
    const position = rangeAnchor(range,root);
    if (!selection.isCollapsed) {
      setAnchor(previous => sameAnchor(previous,position) ? previous : position);
      setSlash(null);return;
    }
    setAnchor(null);setMenu(null);
    let block = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    while (block && block !== root && !['DIV','P','H1','H2','H3','BLOCKQUOTE','LI'].includes(block.nodeName)) block = block.parentElement;
    const before = range.cloneRange();before.selectNodeContents(block || root);before.setEnd(range.startContainer,range.startOffset);
    const prefix = before.toString();
    const match = prefix.match(/^\/([^\n/]{0,24})$/);
    // Text that only starts with '/' (a path, a date) closes the menu instead of showing an empty one.
    if (!match || dismissedSlash.current === prefix || !slashOptions(match[1]).length) {setSlash(null);if (!match) dismissedSlash.current = null;return;}
    slashRange.current = before;
    setSlash(previous => previous?.query === match[1] && sameAnchor(previous.anchor,position) ? previous
      : {query:match[1],anchor:position,index:previous?.query === match[1] ? previous.index : 0});
  },[loading,readOnly]);
  useEffect(() => {
    const outside = event => {
      if (!editor.current?.contains(event.target) && !popup.current?.contains(event.target)) {setAnchor(null);setSlash(null);setMenu(null);}
    };
    const hideDropIndicator = () => setDropIndicator(null);
    const hideHandle = () => {if (!listDrag.current) {handleItem.current = null;setListHandle(null);}};
    window.addEventListener('scroll',hideHandle,true);
    document.addEventListener('selectionchange',inspectSelection);
    document.addEventListener('pointerdown',outside);
    window.addEventListener('scroll',inspectSelection,true);
    window.addEventListener('resize',inspectSelection);
    window.addEventListener('scroll',hideDropIndicator,true);
    window.addEventListener('resize',hideDropIndicator);
    window.addEventListener('blur',hideDropIndicator);
    return () => {
      document.removeEventListener('selectionchange',inspectSelection);document.removeEventListener('pointerdown',outside);
      window.removeEventListener('scroll',inspectSelection,true);window.removeEventListener('resize',inspectSelection);
      window.removeEventListener('scroll',hideDropIndicator,true);window.removeEventListener('resize',hideDropIndicator);
      window.removeEventListener('blur',hideDropIndicator);
      window.removeEventListener('scroll',hideHandle,true);
      textDrag.current = null;
    };
  },[inspectSelection]);

  function commit() {
    const next = readNoteEditor(editor.current);
    if (next.length > MAX_NOTE_LENGTH) {
      editor.current.innerHTML = saved.current ? noteHtml(saved.current,true) : '';
      selectionRange.current = null;slashRange.current = null;setAnchor(null);setSlash(null);
      setNotice('메모 저장 용량을 초과했습니다. 내용을 조금 줄여 주세요.');
      return false;
    }
    if (saved.current !== next) {saved.current = next;edit(next);}
    return true;
  }
  function restoreSelection(preferred) {
    return restoreNoteSelection(editor.current,selectionRange.current,preferred);
  }
  function format(command,value) {
    if (loading || readOnly) return;
    const selection = restoreSelection();
    const applied = command === 'highlight'
      ? document.execCommand('hiliteColor',false,selectedFormats().highlight ? 'transparent' : NOTE_HIGHLIGHT)
      : command === 'toggleColor'
        ? document.execCommand('foreColor',false,toggledNoteColor(selectedFormats().color))
      : document.execCommand(command,false,value);
    const committed = commit();
    if (command === 'foreColor' && applied && committed) rememberNoteColor(value);
    setFormats(selectedFormats());
    if (selection.rangeCount) selectionRange.current = selection.getRangeAt(0).cloneRange();
    setMenu(null);inspectSelection();
  }
  function applyBlock(type,fromSlash = false,shortcutRange = null,autoNumbered = false,listStart = 1) {
    if (loading || readOnly) return;
    const selection = restoreSelection(shortcutRange || (fromSlash ? slashRange.current : selectionRange.current));
    const autoUndo=autoNumbered?autoNumberedUndo(editor.current,selection.getRangeAt(0)):null;
    if (type === 'toggle') {
      const range = selection.getRangeAt(0).cloneRange();
      const element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      const existing = element?.closest('details.notes-toggle');
      if (existing) {focusToggleBody(existing);setMenu(null);commit();return;}
      const lineBlock = node => {
        let current = node.nodeType === 1 ? node : node.parentElement;
        while (current && current !== editor.current && !['DIV','P','H1','H2','H3','BLOCKQUOTE','LI'].includes(current.nodeName)) current=current.parentElement;
        return current;
      };
      const first = lineBlock(range.startContainer), last = lineBlock(range.endContainer);
      if (first && last && first !== editor.current && last !== editor.current && first.parentElement === last.parentElement) {
        range.setStartBefore(first);range.setEndAfter(last);
      }
      const source = readNoteEditor(range.cloneContents(),noteFormatAt(range.commonAncestorContainer,editor.current));
      const toggle = createNoteToggle(noteRuns(source));
      if (!toggle.summary.length) toggle.summary.push({text:'토글'});
      const id = `toggle-${++sequence.current}`;
      const html = noteHtml(serializeNoteRuns([toggle]),true).replace('<details ',`<details data-toggle-id="${id}" `);
      restoreSelection(range);
      document.execCommand('insertHTML',false,html + '<div><br></div>');
      const inserted = editor.current.querySelector(`[data-toggle-id="${id}"]`);
      if (inserted) {inserted.removeAttribute('data-toggle-id');focusToggleBody(inserted);}
      setSlash(null);setMenu(null);commit();inspectSelection();
      return;
    }
    if (type === 'divider') {
      document.execCommand('insertHTML',false,'<hr><div><br></div>');
      setSlash(null);setMenu(null);commit();inspectSelection();
      return;
    }
    if (fromSlash || shortcutRange) document.execCommand('delete');
    if (!autoNumbered && ['bullet','numbered','checklist'].includes(type)) {
      const before = readNoteEditor(editor.current), beforeCaret = caretPoint(editor.current,selection.getRangeAt(0));
      if (convertNoteListItems(editor.current,selection,type)) {
        repairNoteChecklists(editor.current);
        setSlash(null);setMenu(null);
        if (commit() && saved.current !== before) {
          toggleHistory.current.undo.push({before,after:saved.current,beforeCaret,afterCaret:caretPoint(editor.current,selection.getRangeAt(0))});
          toggleHistory.current.redo = [];
        }
        inspectSelection();return;
      }
    }
    if (type === 'checklist') {
      const before=readNoteEditor(editor.current);
      if (applyNoteChecklist(editor.current,selection) && commit()) {
        toggleHistory.current.undo.push({before,after:saved.current});toggleHistory.current.redo=[];
      }
      setSlash(null);setMenu(null);inspectSelection();return;
    }
    clearNoteChecklists(editor.current,selection);
    const inBullet = document.queryCommandState('insertUnorderedList');
    const inNumbered = document.queryCommandState('insertOrderedList');
    if (type === 'bullet'||type === 'numbered') {
      const command=type==='numbered'?'insertOrderedList':'insertUnorderedList';
      if (!(type==='numbered'?inNumbered:inBullet)) {
        if(!inBullet&&!inNumbered)document.execCommand('formatBlock',false,'div');
        document.execCommand(command);
      }
      const node = selection.rangeCount ? selection.getRangeAt(0).startContainer : null;
      const list = (node?.nodeType === 1 ? node : node?.parentElement)?.closest('ol');
      if (type === 'numbered' && listStart > 1 && list && editor.current.contains(list)) list.setAttribute('start',String(listStart));
    } else {
      if (inBullet) document.execCommand('insertUnorderedList');
      else if(inNumbered)document.execCommand('insertOrderedList');
      document.execCommand('formatBlock',false,type === 'quote' ? 'blockquote' : type === 'text' ? 'div' : type);
    }
    setSlash(null);setMenu(null);
    if(commit()&&autoUndo){
      toggleHistory.current.undo.push({...autoUndo,after:saved.current,afterCaret:caretPoint(editor.current,selection.getRangeAt(0))});
      toggleHistory.current.redo=[];
    }
    inspectSelection();
  }
  function hideListHandle() {
    if (listDrag.current || !handleItem.current) return;
    handleItem.current = null;setListHandle(null);
  }
  function showListHandle(event) {
    if (loading || readOnly || listDrag.current || textDrag.current || event.buttons) return;
    const found = noteListItemAtPoint(editor.current,event.clientY);
    if (!found) {hideListHandle();return;}
    handleItem.current = found.item;
    const next = {left:Math.round(found.rect.left - 46),top:Math.round(found.rect.top),height:Math.round(Math.min(found.rect.bottom - found.rect.top,29))};
    setListHandle(previous => previous && previous.left === next.left && previous.top === next.top && previous.height === next.height ? previous : next);
  }
  function endListDrag(event,cancel = false) {
    const drag = listDrag.current;
    if (!drag) return;
    listDrag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.item.classList.remove('notes-list-dragging');
    if (!drag.item.className) drag.item.removeAttribute('class');
    setDropIndicator(null);handleItem.current = null;setListHandle(null);
    if (cancel || loading || readOnly || !editor.current.contains(drag.item)) return;
    const root = editor.current, selection = window.getSelection();
    const beforeCaret = selection?.rangeCount && root.contains(selection.getRangeAt(0).commonAncestorContainer) ? caretPoint(root,selection.getRangeAt(0)) : null;
    if (drag.moved && drag.drop) {
      const before = readNoteEditor(root);
      if (!moveNoteListItemTo(root,drag.item,drag.drop)) return;
      repairNoteChecklists(root);
      const index = [...root.querySelectorAll('li')].indexOf(drag.item);
      if (!commit() || saved.current === before) return;
      // Re-render so the row takes the shape of the list it was dropped into.
      root.innerHTML = noteHtml(saved.current,true);
      selectionRange.current = null;
      restoreSelection();
      const point = {item:index,offset:Number.MAX_SAFE_INTEGER};
      restoreCaretPoint(root,point);
      toggleHistory.current.undo.push({before,after:saved.current,beforeCaret,afterCaret:point});
      toggleHistory.current.redo = [];
      inspectSelection();
      return;
    }
    if (!drag.moved) {
      // A click on the handle puts the caret at the end of its row.
      restoreSelection();
      restoreCaretPoint(root,{item:[...root.querySelectorAll('li')].indexOf(drag.item),offset:Number.MAX_SAFE_INTEGER});
      inspectSelection();
    }
  }
  function focusToggleBody(details) {
    const body = details.querySelector('.notes-toggle-body');
    if (!body) return;
    details.open = true;
    const range = document.createRange();range.selectNodeContents(body.firstElementChild || body);range.collapse(true);
    const selection = window.getSelection();selection.removeAllRanges();selection.addRange(range);
    selectionRange.current = range.cloneRange();
  }
  async function resolveTitle(element,link) {
    const original = element.textContent;
    try {
      const video = youtubeVideo(link.url);
      const {title,author,icon} = await (video ? loadYouTubeInfo(video.url) : loadSiteInfo(link.url));
      if (!element.isConnected || editor.current?.contentEditable !== 'true' || element.textContent !== original) return;
      const before = element.innerHTML;
      const replacement = document.createElement('template');
      replacement.innerHTML = video ? linkHtml(title,video.url,null,author) : siteLinkHtml(title,link.url,null,author,icon);
      element.replaceChildren(...replacement.content.firstChild.childNodes);
      if (readNoteEditor(editor.current).length > MAX_NOTE_LENGTH) element.innerHTML = before;
      commit();
    } catch {
      // Keep the original address if the website is unavailable or requires login.
      if (element.isConnected) setNotice('링크 제목을 가져오지 못해 원래 주소를 남겼습니다.');
    }
  }
  function paste(event) {
    event.preventDefault();
    if (loading || readOnly) return;
    const copiedNote = event.clipboardData.getData('application/x-planer-note');
    const files = noteImageFiles(event.clipboardData);
    if (!copiedNote && files.length) {
      void attachNoteImages(editor.current,files,restoreSelection().getRangeAt(0).cloneRange(),restoreSelection,commit,setNotice);
      return;
    }
    const pasteColor = selectedFormats().color;
    const plain = event.clipboardData.getData('text/plain').replace(/\r\n?/g,'\n');
    if (!plain && !copiedNote) return;
    setNotice('');
    const address = plain.trim();
    const pastedLink = /^https?:\/\/[^\s<>"']+$/i.test(address) && webLink(address);
    if (pastedLink) {
      const root = editor.current, selection = root.ownerDocument.getSelection();
      if (selection?.rangeCount && !selection.isCollapsed && selection.toString().trim()
        && root.contains(selection.getRangeAt(0).commonAncestorContainer)
        && document.execCommand('createLink',false,pastedLink.url)) {
        commit();
        return;
      }
    }
    if (copiedNote) {
      document.execCommand('insertHTML',false,noteHtml(copiedNote,false,pasteColor).replace(/\n/g,'<br>'));
      commit();
      return;
    }
    const pastedList = noteListFromPlainText(plain);
    if (pastedList) {
      document.execCommand('insertHTML',false,noteHtml(pastedList,false,pasteColor).replace(/\n/g,'<br>'));
      repairNoteChecklists(editor.current);
      commit();
      return;
    }
    const pending = [];
    let html = plain.split(/(https?:\/\/[^\s<>"']+)/g).map(part => {
      const candidate = part.replace(/[.,;!?)\]}]+$/,'');
      const video = youtubeVideo(candidate);
      const link = video || webLink(candidate);
      if (!link) return escapeHtml(part).replace(/\n/g,'<br>');
      const id = `link-${++sequence.current}`;
      pending.push({id,link});
      return (video ? linkHtml(candidate,video.url,id) : siteLinkHtml(candidate,link.url,id)) + escapeHtml(part.slice(candidate.length));
    }).join('');
    // A space leaves the caret outside the non-editable link while its title loads.
    if (html.endsWith('</a>')) html += ' ';
    // Chromium's editing command preserves native undo and caret behavior.
    document.execCommand('insertHTML',false,`<span style="color:${pasteColor}">${html}</span>`);
    if (!commit()) return;
    for (const {id,link} of pending) {
      const element = editor.current.querySelector(`[data-paste-id="${id}"]`);
      if (element) resolveTitle(element,link);
    }
  }
  function copy(event,cut = false) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!editor.current.contains(range.commonAncestorContainer)) return;
    const root = editor.current;
    const format = noteFormatAt(range.commonAncestorContainer,root);
    // A selection inside one line copies only its text, not the line's block (heading, list, checklist).
    const currentLine = noteLine(root,selection);
    const inLine = !!currentLine && range.compareBoundaryPoints(Range.START_TO_START,currentLine.range) >= 0
      && range.compareBoundaryPoints(Range.END_TO_END,currentLine.range) <= 0;
    if (inLine || format.block === 'list-text') {
      delete format.block;delete format.listDepth;delete format.listNumbered;delete format.listContinuation;delete format.checked;
    }
    const value = readNoteEditor(range.cloneContents(),format);
    event.preventDefault();
    event.clipboardData.setData('application/x-planer-note',value);
    event.clipboardData.setData('text/plain',noteClipboardText(value));
    event.clipboardData.setData('text/html',noteHtml(value).replace(/\n/g,'<br>'));
    const caretLine = caretLineCut.current;caretLineCut.current = null;
    if (!cut || loading || readOnly) return;
    if (!inLine) {document.execCommand('delete');commit();return;}
    // Ctrl+X with only a caret (keydown selected exactly this line) cuts the whole line, like a code editor.
    if (caretLine && range.compareBoundaryPoints(Range.START_TO_START,caretLine) === 0
      && range.compareBoundaryPoints(Range.END_TO_END,caretLine) === 0) {
      cutLine(currentLine,selection);return;
    }
    // A selection inside one line removes only the selected text, even when it is the whole line.
    applyEditorChange(selection,() => {
      range.deleteContents();
      range.collapse(true);
      selection.removeAllRanges();selection.addRange(range);
    });
  }
  function cutLine(line,selection) {
    applyEditorChange(selection,root => removeNoteLine(root,line,selection));
  }
  function applyEditorChange(selection,change) {
    const root = editor.current;
    const before = readNoteEditor(root), beforeCaret = caretPoint(root,selection.getRangeAt(0));
    change(root);
    repairNoteChecklists(root);
    if (commit() && saved.current !== before) {
      toggleHistory.current.undo.push({before,after:saved.current,beforeCaret,afterCaret:caretPoint(root,selection.getRangeAt(0))});
      toggleHistory.current.redo=[];
    }
    inspectSelection();
  }
  useImperativeHandle(ref,() => ({
    startNewFirstLine() {
      if (loading || readOnly) return;
      const root = editor.current, range = root.ownerDocument.createRange();
      range.selectNodeContents(root);
      range.collapse(true);
      const selection = restoreSelection(range);
      applyEditorChange(selection,() => {
        const firstLine = root.ownerDocument.createElement('div');
        firstLine.append(root.ownerDocument.createElement('br'));
        if (saved.current) root.prepend(firstLine);
        else root.replaceChildren(firstLine);
        selection.collapse(firstLine,0);
        root.scrollTop = 0;
      });
    },
  }));
  const options = slash ? slashOptions(slash.query) : [];
  const activeBlockType = ['h1','h2'].includes(blockType) ? 'h3' : blockType;
  const blockLabel = NOTE_BLOCKS.find(block => block.value === activeBlockType)?.label || '일반 텍스트';
  return <>
    {listHandle && !loading && !readOnly && createPortal(<button type="button" className="notes-list-handle"
      aria-label="목록 항목 끌어서 옮기기" title="끌어서 옮기기" tabIndex={-1}
      style={{left:listHandle.left,top:listHandle.top,height:listHandle.height}}
      onMouseLeave={event => {if (!listDrag.current && !editor.current?.contains(event.relatedTarget)) hideListHandle();}}
      onPointerDown={event => {
        const item = handleItem.current;
        if (event.button !== 0 || !item || !editor.current?.contains(item)) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        listDrag.current = {item,startY:event.clientY,moved:false,drop:null};
        setAnchor(null);setSlash(null);setMenu(null);
      }}
      onPointerMove={event => {
        const drag = listDrag.current;
        if (!drag) return;
        if (!drag.moved && Math.abs(event.clientY - drag.startY) < 4) return;
        if (!drag.moved) {drag.moved = true;drag.item.classList.add('notes-list-dragging');}
        const root = editor.current, bounds = root.getBoundingClientRect();
        if (event.clientY < bounds.top + 24) root.scrollTop -= 12;
        else if (event.clientY > bounds.bottom - 24) root.scrollTop += 12;
        drag.drop = noteListDropTarget(root,drag.item,event.clientX,event.clientY);
        const next = drag.drop?.indicator || null;
        setDropIndicator(previous => previous && next && Object.keys(next).every(key => previous[key] === next[key]) ? previous : next);
      }}
      onPointerUp={event => endListDrag(event)}
      onPointerCancel={event => endListDrag(event,true)}
      onLostPointerCapture={event => {if (listDrag.current) endListDrag(event,true);}}>
      <span aria-hidden="true">⋮⋮</span></button>,document.body)}
    {dropIndicator && !loading && !readOnly && createPortal(<div className="notes-drop-indicator" aria-hidden="true" style={dropIndicator} />,document.body)}
    {anchor && !loading && !readOnly && createPortal(<div ref={popup} className="notes-floating-toolbar"
      style={popupPosition(anchor,menu === 'blocks' ? NOTE_BLOCKS.length * 40 + 54 : menu === 'colors' ? 190 : 42,330)}
      onMouseDown={event => event.preventDefault()} onKeyDown={event => {
        if (event.key === 'Tab') event.stopPropagation();
        if (event.key === 'Escape') {event.preventDefault();setMenu(null);setAnchor(null);editor.current.focus();}
        if (menu && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
          event.preventDefault();
          const buttons = [...popup.current.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')];
          const current = buttons.indexOf(document.activeElement);
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[index]?.focus();
        }
      }}>
      <div className="notes-floating-actions" role="toolbar" aria-label="선택한 글자 서식">
        <button type="button" className="notes-block-picker" aria-label="블록 유형 변경" aria-haspopup="menu"
          title={blockLabel} aria-expanded={menu === 'blocks'} onClick={() => setMenu(current => current === 'blocks' ? null : 'blocks')}><span className="notes-block-label">{blockLabel}</span><span aria-hidden="true">⌄</span></button>
        <span className="notes-toolbar-divider" />
        <button type="button" className={`notes-format-button${menu === 'colors' ? ' is-active' : ''}`} aria-label="텍스트 색상"
          title="텍스트 색상 (Ctrl+Shift+C)" aria-haspopup="menu" aria-expanded={menu === 'colors'} onClick={() => setMenu(current => current === 'colors' ? null : 'colors')}>
          <span className="notes-color-letter" style={{borderColor:formats.color}}>A</span>
        </button>
        {[['bold','굵게','Ctrl+B'],['italic','기울임꼴','Ctrl+I'],['underline','밑줄','Ctrl+U'],['strikeThrough','취소선','Ctrl+Shift+S'],['highlight','형광펜','Ctrl+Shift+H']].map(([command,label,shortcut]) =>
          <button type="button" key={command} aria-label={label} aria-pressed={formats[command]}
            title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
            className={`notes-format-button${formats[command] ? ' is-active' : ''}`} onClick={() => format(command)}>
            {command === 'bold' ? <b>B</b> : command === 'italic' ? <i>I</i> : command === 'underline' ? <u>U</u> : command === 'strikeThrough' ? <s>S</s> : <span className="notes-highlight-label">H</span>}
          </button>)}
      </div>
      {menu === 'blocks' && <div className="notes-format-menu" role="menu" aria-label="블록 유형">
        {NOTE_BLOCKS.map(block => <button type="button" role="menuitem" key={block.value}
          className={activeBlockType === block.value ? 'is-active' : ''} onClick={() => applyBlock(block.value)}>
          <span className="notes-block-icon">{block.icon}</span><span>{block.label}</span></button>)}
      </div>}
      {menu === 'colors' && <div className="notes-color-menu" role="menu" aria-label="텍스트 색상 선택">
        {NOTE_TEXT_COLORS.map(color => <button type="button" key={color.value} role="menuitemradio"
          aria-checked={formats.color === color.value} onClick={() => format('foreColor',color.value)}>
          <span style={{color:color.value}}>A</span>{color.label}</button>)}
      </div>}
    </div>,document.body)}
    {slash && options.length > 0 && !loading && !readOnly && createPortal(<div ref={popup} id={menuId} className="notes-slash-menu"
      style={popupPosition(slash.anchor,Math.min(296,options.length * 40 + 10),280)}
      role="listbox" aria-label="블록 추가" onMouseDown={event => event.preventDefault()}>
      {options.length ? options.map((block,index) => <button type="button" key={block.value} id={`${menuId}-${index}`}
        role="option" aria-selected={index === slash.index % options.length} className={index === slash.index % options.length ? 'is-active' : ''}
        onMouseEnter={() => setSlash(current => current ? {...current,index} : current)} onClick={() => applyBlock(block.value,true)}>
        <span className="notes-block-icon">{block.icon}</span><span>{block.label}</span></button>) : null}
    </div>,document.body)}
    <div ref={editor} className="notes-text-editor" role="textbox" aria-label="메모 내용" aria-multiline="true"
      aria-readonly={readOnly || loading} aria-disabled={loading} data-placeholder="메모를 입력하거나 / 로 블록을 선택하세요."
      aria-controls={slash ? menuId : undefined} aria-expanded={!!slash}
      aria-activedescendant={slash && options.length ? `${menuId}-${slash.index % options.length}` : undefined}
      contentEditable={!loading && !readOnly} suppressContentEditableWarning spellCheck={false}
      onInput={() => {
        toggleHistory.current.redo=[];
        hideListHandle();
        if (!loading && !readOnly && !composing.current) repairNoteChecklists(editor.current);
        if (!loading && !readOnly && !composing.current && !dismissedSlash.current) {
          const shortcut=noteSlashShortcut(editor.current,window.getSelection(),true);
          if (shortcut) {applyBlock(shortcut.type,false,shortcut.range);return;}
        }
        commit();inspectSelection();
      }} onPaste={paste} onCopy={copy} onCut={event => copy(event,true)}
      onDragStart={event => {
        setDropIndicator(null);
        if (loading || readOnly || composing.current) {event.preventDefault();return;}
        textDrag.current = startNoteTextDrag(editor.current,event);
        if (textDrag.current) {setAnchor(null);setSlash(null);setMenu(null);}
      }}
      onDragOver={event => {
        if (!loading && !readOnly && noteFileDrag(event.dataTransfer)) {
          event.preventDefault();event.dataTransfer.dropEffect = 'copy';setDropIndicator(null);return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = !loading && !readOnly && noteTextDropAllowed(editor.current,textDrag.current,event) ? 'move' : 'none';
        const next=!loading && !readOnly ? noteTextDropIndicator(editor.current,textDrag.current,event) : null;
        setDropIndicator(previous => previous && next && Object.keys(next).every(key=>previous[key]===next[key]) ? previous : next);
      }}
      onDragLeave={event => {if (!event.currentTarget.contains(event.relatedTarget)) setDropIndicator(null);}}
      onMouseMove={showListHandle}
      onMouseLeave={event => {if (!event.relatedTarget?.closest?.('.notes-list-handle')) hideListHandle();}}
      onDrop={event => {
        event.preventDefault();
        // The move is handled here; native drag cleanup must not delete it again.
        event.dataTransfer.dropEffect = 'none';
        setDropIndicator(null);
        if (loading || readOnly) return;
        if (noteFileDrag(event.dataTransfer)) {
          const files = noteImageFiles(event.dataTransfer);
          if (!files.length) {setNotice('사진 파일을 끌어다 놓아 주세요.');return;}
          const root = editor.current;
          let range = document.caretRangeFromPoint(event.clientX,event.clientY);
          if (!range || !root.contains(range.commonAncestorContainer)) {
            range = document.createRange();range.selectNodeContents(root);range.collapse(false);
          }
          // Dropping onto a photo inserts after it instead of inside its button.
          const image = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest(noteImageSelector);
          if (image) {range.setStartAfter(image);range.collapse(true);}
          void attachNoteImages(root,files,range,restoreSelection,commit,setNotice);
          return;
        }
        const root=editor.current, moved=prepareNoteTextMove(root,textDrag.current,event);
        if (!moved) return;
        if (moved.text.length > MAX_NOTE_LENGTH) {setNotice('메모 저장 용량을 초과해 텍스트를 옮기지 못했습니다.');return;}
        const before=readNoteEditor(root);
        textDrag.current=null;
        const caret=applyNoteTextMove(root,moved);
        if (!caret) return;
        selectionRange.current=caret.cloneRange();
        if (commit()) {
          toggleHistory.current.undo.push({before,after:saved.current});toggleHistory.current.redo=[];
        }
        inspectSelection();
      }}
      onDragEnd={() => {textDrag.current=null;setDropIndicator(null);if (!loading && !readOnly) commit();inspectSelection();}}
      onToggleCapture={event => {
        if (!loading && !readOnly && event.target.matches?.('details.notes-toggle')) commit();
      }}
      onMouseDown={event => {
        if (event.target.closest?.('[data-note-checkbox]')) event.preventDefault();
        // A photo is selected by focusing it, not by a text selection around it: a text
        // selection opens the format toolbar and Backspace would not reach the photo.
        const image=event.target.closest?.(noteImageSelector);
        if (image && event.button === 0 && !event.target.closest('.notes-image-resize')) {
          event.preventDefault();
          imageWasSelected.current=document.activeElement === image;
          image.focus({preventScroll:true});
          window.getSelection()?.removeAllRanges();
        }
      }}
      onPointerDown={event => {
        if (!loading && !readOnly) resizeNoteImage(event,editor.current,(image,width) => applyEditorChange(restoreSelection(),() => {
          image.dataset.noteImageWidth = String(width);
          image.style.setProperty('--note-image-width',width + 'px');
        }));
      }}
      onClick={event => {
        if (event.target.closest?.('.notes-image-resize')) {event.preventDefault();return;}
        // The first click selects a photo (Backspace/Delete then removes it); a click on the selected photo opens the viewer.
        const clickedImage=event.target.closest?.(noteImageSelector);
        if (clickedImage) {
          event.preventDefault();
          const open=imageWasSelected.current;imageWasSelected.current=false;
          if (!open || !openNoteImage(clickedImage)) clickedImage.focus({preventScroll:true});
          return;
        }
        const checkbox=event.target.closest?.('[data-note-checkbox]');
        if (checkbox) {
          event.preventDefault();
          if (loading || readOnly) return;
          repairNoteChecklists(editor.current);
          const before=readNoteEditor(editor.current);
          toggleNoteChecklist(checkbox.closest('li'));
          settleNoteChecklistItem(checkbox.closest('li'));
          if (commit()) {toggleHistory.current.undo.push({before,after:saved.current});toggleHistory.current.redo=[];}
          return;
        }
        const inlineLink = event.target.closest?.(noteInlineLinkSelector);
        if (inlineLink) {
          event.preventDefault();
          if (event.ctrlKey || event.metaKey || readOnly) {
            const link = webLink(inlineLink.getAttribute('href'));
            if (link) window.open(link.url,'_blank','noopener,noreferrer');
          }
          return;
        }
        if (event.target.closest?.('.notes-toggle-title') && !event.target.closest('a')) event.preventDefault();
      }}
      onLoadCapture={event => {if (event.target.matches?.('.notes-site-icon')) event.target.parentElement.classList.add('has-site-icon');}}
      onErrorCapture={event => {
        if (event.target.matches?.('.notes-site-icon')) {
          event.target.parentElement.classList.remove('has-site-icon');event.target.remove();
        }
      }}
      onCompositionStart={() => {composing.current = true;setAnchor(null);setSlash(null);}}
      onCompositionEnd={() => {composing.current = false;if (!loading && !readOnly) repairNoteChecklists(editor.current);commit();inspectSelection();}}
      onKeyDown={event => {
        const image = event.target.closest?.(noteImageSelector);
        if (image) {
          if ((event.key === 'Enter' || event.key === ' ') && openNoteImage(image)) {event.preventDefault();return;}
          if (!loading && !readOnly && ['Backspace','Delete'].includes(event.key)) {
            event.preventDefault();
            const range = document.createRange();
            range.setStartBefore(image);range.collapse(true);
            const selection = restoreSelection(range);
            applyEditorChange(selection,root => {
              const parent = image.parentNode, next = image.nextSibling;
              // The trailing photo's caret placeholder does not belong to the note.
              if (next?.matches?.('br[data-note-image-caret]') && !next.nextSibling) next.remove();
              image.remove();
              if (parent !== root && !parent.hasChildNodes()) parent.append(document.createElement('br'));
              selection.collapse(range.startContainer,range.startOffset);
            });
            return;
          }
        }
        if (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
        hideListHandle();
        if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && ['ArrowUp','ArrowDown'].includes(event.key) && !loading && !readOnly) {
          const selection = window.getSelection();
          let moved = false;
          if (selection?.rangeCount && editor.current.contains(selection.getRangeAt(0).commonAncestorContainer)) {
            applyEditorChange(selection,root => {moved = moveNoteListItems(root,selection,event.key === 'ArrowUp');});
          }
          if (moved) {
            event.preventDefault();
            const node = selection.focusNode;
            (node?.nodeType === 1 ? node : node?.parentElement)?.scrollIntoView?.({block:'nearest'});
            return;
          }
        }
        if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey && !loading && !readOnly) {
          const before=readNoteEditor(editor.current);
          if (changeNoteListDepth(editor.current,window.getSelection(),event.shiftKey)) {
            event.preventDefault();event.stopPropagation();
            if (commit() && saved.current !== before) {
              toggleHistory.current.undo.push({before,after:saved.current});toggleHistory.current.redo=[];
            }
            inspectSelection();return;
          }
        }
        if (['Enter',' '].includes(event.key) && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
          && !loading && !readOnly && !dismissedSlash.current) {
          const shortcut=noteSlashShortcut(editor.current,window.getSelection());
          if (shortcut) {event.preventDefault();applyBlock(shortcut.type,false,shortcut.range);return;}
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && !loading) {
          const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
          const selection = window.getSelection();
          if (key === 'a' && noteLineSelected(editor.current,selection,lineSelection.current)) {
            event.preventDefault();selectWholeNote(editor.current,selection);lineSelection.current = null;
            inspectSelection();return;
          }
          if (key === 'a' || (key === 'x' && !readOnly && selection?.isCollapsed)) {
            const line = noteLine(editor.current,selection);
            if (line) {
              if (!noteRangeHasContent(line.range)) {
                if (key === 'x') {
                  event.preventDefault();cutLine(line,selection);return;
                }
                line.range.collapse(true);
              }
              if (key === 'a') event.preventDefault();
              selection.removeAllRanges();selection.addRange(line.range);
              // The native cut that follows removes the whole line (see copy()).
              if (key === 'x') caretLineCut.current = line.range.cloneRange();
              if (key === 'a') {
                lineSelection.current = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
                inspectSelection();return;
              }
            }
          }
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !loading && !readOnly) {
          if (event.shiftKey && (event.code === 'Digit4' || event.key === '4')) {
            event.preventDefault();applyBlock('checklist');return;
          }
          const key=event.key.toLowerCase(), redo=(key==='z' && event.shiftKey) || key==='y';
          if (key==='z' || key==='y') {
            const history=toggleHistory.current, from=redo?history.redo:history.undo, to=redo?history.undo:history.redo;
            const entry=from.at(-1);
            if (entry && saved.current===(redo?entry.before:entry.after)) {
              event.preventDefault();from.pop();to.push(entry);
              const value=redo?entry.after:entry.before;
              editor.current.innerHTML=noteHtml(value,true);saved.current=value;edit(value);
              selectionRange.current=null;setAnchor(null);setMenu(null);setSlash(null);
              restoreSelection();
              const point=redo?entry.afterCaret:entry.beforeCaret;
              if(point)restoreCaretPoint(editor.current,point);
              inspectSelection();return;
            }
          }
        }
        if (['Enter','Backspace'].includes(event.key) && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !loading && !readOnly) {
          const root=editor.current, selection=window.getSelection();
          if (event.key === 'Backspace' && onFocusTitle) {
            const firstLine = firstEmptyNoteLine(root,selection);
            if (firstLine) {
              event.preventDefault();
              cutLine(firstLine,selection);
              onFocusTitle();
              return;
            }
          }
          const before=readNoteEditor(root);
          const beforeCaret=selection?.rangeCount && root.contains(selection.getRangeAt(0).commonAncestorContainer)
            ? caretPoint(root,selection.getRangeAt(0)) : null;
          if (editNoteListKey(root,selection,event.key)||editNoteChecklistKey(root,selection,event.key)) {
            event.preventDefault();
            if (commit() && saved.current !== before) {
              toggleHistory.current.undo.push({before,after:saved.current,beforeCaret,afterCaret:caretPoint(root,selection.getRangeAt(0))});
              toggleHistory.current.redo=[];
            }
            inspectSelection();return;
          }
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !loading && !readOnly) {
          const selection = window.getSelection();
          const node = selection?.anchorNode;
          const element = node?.nodeType === 1 ? node : node?.parentElement;
          const title = element?.closest('.notes-toggle-title');
          if (title) {
            event.preventDefault();
            const before=readNoteEditor(editor.current);
            if (insertNextNoteToggle(editor.current,title.closest('details'))) {
              commit();
              toggleHistory.current.undo.push({before,after:saved.current});toggleHistory.current.redo=[];
              inspectSelection();
            }
            else setNotice('새 토글을 추가하지 못했습니다. 메모 저장 용량을 확인해 주세요.');
            return;
          }
        }
        if (event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey && !loading && !readOnly) {
          const selection = window.getSelection();
          if (selection?.isCollapsed && selection.rangeCount) {
            const range = selection.getRangeAt(0);
            if (editor.current.contains(range.commonAncestorContainer)) {
              let block = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
              while (block && block !== editor.current && !['DIV','P','H1','H2','H3','BLOCKQUOTE','LI'].includes(block.nodeName)) block = block.parentElement;
              const prefix = range.cloneRange();
              prefix.selectNodeContents(block || editor.current);
              prefix.setEnd(range.startContainer,range.startOffset);
              if (prefix.toString() === '---') {
                event.preventDefault();
                applyBlock('divider',false,prefix);
                return;
              }
              if (['[]','[ ]'].includes(prefix.toString())) {
                event.preventDefault();applyBlock('checklist',false,prefix);return;
              }
              const number = prefix.toString().match(/^([1-9]\d{0,3})\.$/);
              if (number&&block?.parentElement?.nodeName!=='OL') {
                event.preventDefault();applyBlock('numbered',false,prefix,true,Number(number[1]));return;
              }
              const markdown = {'>':'quote','##':'h3'}[prefix.toString()];
              if (markdown && !block?.closest?.('.notes-toggle-title,li')) {
                event.preventDefault();applyBlock(markdown,false,prefix,true);return;
              }
              if (prefix.toString() === '-' && block?.nodeName !== 'LI') {
                event.preventDefault();
                applyBlock('bullet',false,prefix);
                return;
              }
            }
          }
        }
        if (slash && !event.ctrlKey && !event.metaKey && !event.altKey) {
          if (['ArrowDown','ArrowUp'].includes(event.key)) {
            event.preventDefault();
            if (options.length) setSlash(current => ({...current,index:(current.index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length}));
            return;
          }
          if (event.key === 'Enter' && options.length) {event.preventDefault();applyBlock(options[slash.index % options.length].value,true);return;}
          if (event.key === 'Escape') {event.preventDefault();dismissedSlash.current = '/' + slash.query;setSlash(null);return;}
        }
        if (event.key === 'Escape') {setAnchor(null);setMenu(null);}
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.nativeEvent.isComposing) {
          const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
          if (event.shiftKey) {
            if (key === 'h' || key === 'c' || key === 's') {
              event.preventDefault();
              format(key === 'h' ? 'highlight' : key === 's' ? 'strikeThrough' : 'toggleColor');
            }
            return;
          }
          if (['b','u','i'].includes(key)) {event.preventDefault();format({b:'bold',u:'underline',i:'italic'}[key]);}
        }
      }} />
    {notice && <p className="notes-link-notice" role="status">{notice}</p>}
  </>;
}
