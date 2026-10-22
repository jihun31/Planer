import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_NOTE_LENGTH } from '../../features/notes/notepadStore.mjs';
import { escapeHtml, linkHtml, loadYouTubeInfo, youtubeVideo } from '../../features/notes/youtubeLinks.mjs';
import { NOTE_BLOCKS, NOTE_HIGHLIGHT, NOTE_TEXT_COLORS, noteColor, noteHtml, notePlainText } from '../../features/notes/noteRichText.mjs';
import { noteFormatAt, readNoteEditor } from '../../features/notes/noteEditorDom.mjs';
import { recentNoteColor, rememberNoteColor } from '../../features/notes/noteEditorPreferences.mjs';

function selectedFormats() {
  const colors = ['hiliteColor','backColor'].map(command => document.queryCommandValue(command).replace(/\s/g,'').toLowerCase());
  return {bold:document.queryCommandState('bold'),italic:document.queryCommandState('italic'),
    underline:document.queryCommandState('underline'),
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
function slashOptions(query) {
  const search = query.replace(/\s/g,'').toLowerCase();
  return NOTE_BLOCKS.filter(block => block.search.replace(/\s/g,'').toLowerCase().includes(search));
}

export function NoteTextEditor({text,edit,loading,readOnly}) {
  const editor = useRef(null);
  const saved = useRef(null);
  const sequence = useRef(0);
  const selectionRange = useRef(null);
  const slashRange = useRef(null);
  const dismissedSlash = useRef(null);
  const composing = useRef(false);
  const popup = useRef(null);
  const menuId = useId();
  const [formats,setFormats] = useState({bold:false,italic:false,underline:false,highlight:false,color:NOTE_TEXT_COLORS[0].value});
  const [anchor,setAnchor] = useState(null);
  const [menu,setMenu] = useState(null);
  const [blockType,setBlockType] = useState('text');
  const [slash,setSlash] = useState(null);
  const [notice,setNotice] = useState('');
  useLayoutEffect(() => {
    if (saved.current !== text) {
      editor.current.innerHTML = text ? noteHtml(text,true) : '';
      saved.current = text;
      selectionRange.current = null;
      slashRange.current = null;
      setAnchor(null);setSlash(null);setMenu(null);
    }
  },[text]);
  const inspectSelection = useCallback(() => {
    const root = editor.current, selection = window.getSelection();
    if (loading || readOnly || composing.current || !root || root.closest('[hidden]') || !selection?.rangeCount
      || !root.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      setAnchor(null);setSlash(null);setMenu(null);return;
    }
    const range = selection.getRangeAt(0).cloneRange();
    selectionRange.current = range;
    const next = selectedFormats();
    setFormats(previous => Object.keys(next).every(key => next[key] === previous[key]) ? previous : next);
    setBlockType(noteFormatAt(range.startContainer,root).block || 'text');
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
    if (!match || dismissedSlash.current === prefix) {setSlash(null);if (!match) dismissedSlash.current = null;return;}
    slashRange.current = before;
    setSlash(previous => previous?.query === match[1] && sameAnchor(previous.anchor,position) ? previous
      : {query:match[1],anchor:position,index:previous?.query === match[1] ? previous.index : 0});
  },[loading,readOnly]);
  useEffect(() => {
    const outside = event => {
      if (!editor.current?.contains(event.target) && !popup.current?.contains(event.target)) {setAnchor(null);setSlash(null);setMenu(null);}
    };
    document.addEventListener('selectionchange',inspectSelection);
    document.addEventListener('pointerdown',outside);
    window.addEventListener('scroll',inspectSelection,true);
    window.addEventListener('resize',inspectSelection);
    return () => {
      document.removeEventListener('selectionchange',inspectSelection);document.removeEventListener('pointerdown',outside);
      window.removeEventListener('scroll',inspectSelection,true);window.removeEventListener('resize',inspectSelection);
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
    const selection = window.getSelection();
    const range = preferred || selectionRange.current;
    editor.current.focus();
    if (range && editor.current.contains(range.commonAncestorContainer)) {
      selection.removeAllRanges();selection.addRange(range);
    } else {
      const end = document.createRange();end.selectNodeContents(editor.current);end.collapse(false);
      selection.removeAllRanges();selection.addRange(end);
    }
    return selection;
  }
  function format(command,value) {
    if (loading || readOnly) return;
    const selection = restoreSelection();
    const applied = command === 'highlight'
      ? document.execCommand('hiliteColor',false,selectedFormats().highlight ? 'transparent' : NOTE_HIGHLIGHT)
      : document.execCommand(command,false,value);
    const committed = commit();
    if (command === 'foreColor' && applied && committed) rememberNoteColor(value);
    setFormats(selectedFormats());
    if (selection.rangeCount) selectionRange.current = selection.getRangeAt(0).cloneRange();
    setMenu(null);inspectSelection();
  }
  function applyBlock(type,fromSlash = false,shortcutRange = null) {
    if (loading || readOnly) return;
    restoreSelection(shortcutRange || (fromSlash ? slashRange.current : selectionRange.current));
    if (type === 'divider') {
      document.execCommand('insertHTML',false,'<hr><div><br></div>');
      setSlash(null);setMenu(null);commit();inspectSelection();
      return;
    }
    if (fromSlash || shortcutRange) document.execCommand('delete');
    const inList = document.queryCommandState('insertUnorderedList');
    if (type === 'bullet') {
      if (!inList) {document.execCommand('formatBlock',false,'div');document.execCommand('insertUnorderedList');}
    } else {
      if (inList) document.execCommand('insertUnorderedList');
      document.execCommand('formatBlock',false,type === 'quote' ? 'blockquote' : type === 'text' ? 'div' : type);
    }
    setSlash(null);setMenu(null);commit();inspectSelection();
  }
  async function resolveTitle(element,video) {
    const original = element.textContent;
    try {
      const {title,author} = await loadYouTubeInfo(video.url);
      if (!element.isConnected || editor.current?.contentEditable !== 'true' || element.textContent !== original) return;
      const before = element.innerHTML;
      const replacement = document.createElement('template');
      replacement.innerHTML = linkHtml(title,video.url,null,author);
      element.replaceChildren(...replacement.content.firstChild.childNodes);
      if (readNoteEditor(editor.current).length > MAX_NOTE_LENGTH) element.innerHTML = before;
      commit();
    } catch {
      // Retain the URL so offline/private/deleted videos never lose the pasted link.
      if (element.isConnected) setNotice('영상 제목을 가져오지 못해 원래 링크를 남겼습니다.');
    }
  }
  function paste(event) {
    event.preventDefault();
    if (loading || readOnly) return;
    const plain = event.clipboardData.getData('text/plain').replace(/\r\n?/g,'\n');
    if (!plain) return;
    setNotice('');
    const copiedNote = event.clipboardData.getData('application/x-planer-note');
    if (copiedNote) {
      document.execCommand('insertHTML',false,noteHtml(copiedNote).replace(/\n/g,'<br>'));
      commit();
      return;
    }
    const pending = [];
    let html = plain.split(/(https?:\/\/[^\s<>"']+)/g).map(part => {
      const candidate = part.replace(/[.,;!?)\]}]+$/,'');
      const video = youtubeVideo(candidate);
      if (!video) return escapeHtml(part).replace(/\n/g,'<br>');
      const id = `yt-${++sequence.current}`;
      pending.push({id,video});
      return linkHtml(candidate,video.url,id) + escapeHtml(part.slice(candidate.length));
    }).join('');
    // A space leaves the caret outside the non-editable link while its title loads.
    if (html.endsWith('</a>')) html += ' ';
    // Chromium's editing command preserves native undo and caret behavior.
    document.execCommand('insertHTML',false,html);
    if (!commit()) return;
    for (const {id,video} of pending) {
      const element = editor.current.querySelector(`[data-paste-id="${id}"]`);
      if (element) resolveTitle(element,video);
    }
  }
  function copy(event,cut = false) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!editor.current.contains(range.commonAncestorContainer)) return;
    const value = readNoteEditor(range.cloneContents(),noteFormatAt(range.commonAncestorContainer,editor.current));
    event.preventDefault();
    event.clipboardData.setData('application/x-planer-note',value);
    event.clipboardData.setData('text/plain',notePlainText(value));
    event.clipboardData.setData('text/html',noteHtml(value).replace(/\n/g,'<br>'));
    if (cut && !loading && !readOnly) { document.execCommand('delete');commit(); }
  }
  const options = slash ? slashOptions(slash.query) : [];
  const blockLabel = NOTE_BLOCKS.find(block => block.value === blockType)?.label || '일반 텍스트';
  return <>
    {anchor && !loading && !readOnly && createPortal(<div ref={popup} className="notes-floating-toolbar"
      style={popupPosition(anchor,menu === 'blocks' ? 334 : menu === 'colors' ? 190 : 42,290)}
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
        {[['bold','굵게','Ctrl+B'],['italic','기울임꼴','Ctrl+I'],['underline','밑줄','Ctrl+U'],['highlight','형광펜','Ctrl+Shift+H']].map(([command,label,shortcut]) =>
          <button type="button" key={command} aria-label={label} aria-pressed={formats[command]}
            title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
            className={`notes-format-button${formats[command] ? ' is-active' : ''}`} onClick={() => format(command)}>
            {command === 'bold' ? <b>B</b> : command === 'italic' ? <i>I</i> : command === 'underline' ? <u>U</u> : <span className="notes-highlight-label">H</span>}
          </button>)}
      </div>
      {menu === 'blocks' && <div className="notes-format-menu" role="menu" aria-label="블록 유형">
        {NOTE_BLOCKS.map(block => <button type="button" role="menuitem" key={block.value}
          className={blockType === block.value ? 'is-active' : ''} onClick={() => applyBlock(block.value)}>
          <span className="notes-block-icon">{block.icon}</span><span>{block.label}</span></button>)}
      </div>}
      {menu === 'colors' && <div className="notes-color-menu" role="menu" aria-label="텍스트 색상 선택">
        {NOTE_TEXT_COLORS.map(color => <button type="button" key={color.value} role="menuitemradio"
          aria-checked={formats.color === color.value} onClick={() => format('foreColor',color.value)}>
          <span style={{color:color.value}}>A</span>{color.label}</button>)}
      </div>}
    </div>,document.body)}
    {slash && !loading && !readOnly && createPortal(<div ref={popup} id={menuId} className="notes-slash-menu"
      style={popupPosition(slash.anchor,Math.min(296,options.length * 40 + 10),280)}
      role="listbox" aria-label="블록 추가" onMouseDown={event => event.preventDefault()}>
      {options.length ? options.map((block,index) => <button type="button" key={block.value} id={`${menuId}-${index}`}
        role="option" aria-selected={index === slash.index % options.length} className={index === slash.index % options.length ? 'is-active' : ''}
        onMouseEnter={() => setSlash(current => current ? {...current,index} : current)} onClick={() => applyBlock(block.value,true)}>
        <span className="notes-block-icon">{block.icon}</span><span>{block.label}</span></button>) : <div className="notes-slash-empty">일치하는 블록이 없습니다.</div>}
    </div>,document.body)}
    <div ref={editor} className="notes-text-editor" role="textbox" aria-label="메모 내용" aria-multiline="true"
      aria-readonly={readOnly || loading} aria-disabled={loading} data-placeholder="메모를 입력하거나 / 로 블록을 선택하세요."
      aria-controls={slash ? menuId : undefined} aria-expanded={!!slash}
      aria-activedescendant={slash && options.length ? `${menuId}-${slash.index % options.length}` : undefined}
      contentEditable={!loading && !readOnly} suppressContentEditableWarning spellCheck={false}
      onInput={() => {commit();inspectSelection();}} onPaste={paste} onCopy={copy} onCut={event => copy(event,true)} onDrop={event => event.preventDefault()}
      onCompositionStart={() => {composing.current = true;setAnchor(null);setSlash(null);}}
      onCompositionEnd={() => {composing.current = false;commit();inspectSelection();}}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || composing.current) return;
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
            if (key === 'h' || key === 'c') {
              event.preventDefault();
              format(key === 'h' ? 'highlight' : 'foreColor',key === 'c' ? recentNoteColor() : undefined);
            }
            return;
          }
          if (['b','u','i'].includes(key)) {event.preventDefault();format({b:'bold',u:'underline',i:'italic'}[key]);}
        }
      }} />
    {notice && <p className="notes-link-notice" role="status">{notice}</p>}
  </>;
}
