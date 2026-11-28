import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ALL_NOTES, MAX_FOLDER_DEPTH, folderDescendantIds, folderMove, folderTree, foldersWithMove, visibleNotes } from '../../features/notes/noteLibrary.mjs';
import { notePlainText } from '../../features/notes/noteRichText.mjs';
import { NotesHelp } from './NotesHelp.jsx';
import { NoteEditorActiveProvider } from './NoteTextEditor.jsx';

const MAX_MOUNTED_NOTES = 5;

function lruOpenedNotes(previous, activeId, nextId, limit = MAX_MOUNTED_NOTES) {
  const order = [];
  for (const id of previous) {
    if (id && id !== activeId && id !== nextId && !order.includes(id)) order.push(id);
  }
  if (activeId && activeId !== nextId) order.push(activeId);
  if (nextId) order.push(nextId);
  return order.length > limit ? order.slice(order.length - limit) : order;
}

const collapsedKey = uid => `planer:note-folders-collapsed:${uid ?? ''}`;
function readCollapsed(uid) {
  try { const value = JSON.parse(window.localStorage.getItem(collapsedKey(uid)) || '[]'); return new Set(Array.isArray(value) ? value : []); }
  catch { return new Set(); }
}
// Drop zone: the middle half of a folder nests into it, the outer quarters reorder around it.
function dropPosition(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = window.matchMedia('(max-width:900px)').matches ? (event.clientX-rect.left)/rect.width : (event.clientY-rect.top)/rect.height;
  return ratio < .25 ? 'before' : ratio > .75 ? 'after' : 'inside';
}

export function NotesWorkspace({ library, renderEditor }) {
  const {notes,folders,error,setView} = library;
  const [folder,setFolder] = useState(ALL_NOTES);
  const [selectedId,setSelectedId] = useState(null);
  const [opened,setOpened] = useState([]);
  const [search,setSearch] = useState('');
  const [folderForm,setFolderForm] = useState(null);
  const [menu,setMenu] = useState(null);
  const menuRef = useRef(null);
  const [busy,setBusy] = useState(false);
  const [failure,setFailure] = useState('');
  const [draggedId,setDraggedId] = useState(null);
  const [dropTarget,setDropTarget] = useState(null);
  const [pendingMove,setPendingMove] = useState(null);
  const displayFolders = foldersWithMove(folders,pendingMove);
  const tree = folderTree(displayFolders);
  const [collapsed,setCollapsed] = useState(() => ({uid:library.uid,ids:readCollapsed(library.uid)}));
  const collapsedIds = collapsed.uid === library.uid ? collapsed.ids : readCollapsed(library.uid);
  function setFolderOpen(id,open) {
    const next = new Set(collapsedIds);
    if (open) next.delete(id); else next.add(id);
    try { window.localStorage.setItem(collapsedKey(library.uid),JSON.stringify([...next])); } catch { /* Only this window remembers it. */ }
    setCollapsed({uid:library.uid,ids:next});
  }
  let hiddenBelow = Infinity;
  const shownRows = tree.filter(row => {
    if (row.depth > hiddenBelow) return false;
    hiddenBelow = row.hasChildren && collapsedIds.has(row.folder.id) ? row.depth : Infinity;
    return true;
  });
  const folderDepth = id => tree.find(row => row.folder.id === id)?.depth ?? 1;
  const currentFolder = folders.find(item => item.id === folder);
  const activeFolder = currentFolder ? folder : ALL_NOTES;
  const folderName = currentFolder?.name || '전체 메모';
  const searching=!!search.trim();
  const viewMatches=library.pageFolder === undefined || (library.pageFolder === activeFolder && library.searchAll === searching);
  const loading=library.loading || !viewMatches;
  const visible = visibleNotes(viewMatches ? (library.pageNotes || notes) : [],activeFolder,search);
  useEffect(()=>{setView?.(activeFolder,searching);},[setView,activeFolder,searching]);
  const retained=notes.find(note=>note.id === selectedId && visibleNotes([note],activeFolder,search).length);
  const selected = visible.find(note => note.id === selectedId) || retained || visible[0];
  const resolvedId = selected?.id ?? null;
  useEffect(() => { if (selectedId !== resolvedId) setSelectedId(resolvedId); },[selectedId,resolvedId]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector('button')?.focus();
    const close = event => { if (!menuRef.current?.contains(event.target)) setMenu(null); };
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); setMenu(null); menu.trigger.focus(); }
      if (['ArrowDown','ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const buttons = [...menuRef.current.querySelectorAll('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
      if (event.key === 'Tab') { event.stopPropagation();setMenu(null); }
    };
    const dismiss = () => setMenu(null);
    document.addEventListener('pointerdown',close);
    menuRef.current?.addEventListener('keydown',key);
    window.addEventListener('resize',dismiss);
    window.addEventListener('scroll',dismiss,true);
    const element = menuRef.current;
    return () => {
      document.removeEventListener('pointerdown',close);
      element?.removeEventListener('keydown',key);
      window.removeEventListener('resize',dismiss);
      window.removeEventListener('scroll',dismiss,true);
    };
  },[menu]);
  const editors = useMemo(() => lruOpenedNotes(opened, null, selected?.id), [opened, selected?.id]);
  const remember = id => setOpened(previous => lruOpenedNotes(previous, selected?.id, id));
  function selectNote(id) { remember(id); setSelectedId(id); }
  function selectFolder(id) { remember(); setFolder(id); setSelectedId(null); setSearch(''); setMenu(null); }
  async function run(task,showBusy = true) {
    remember();
    setFailure(''); if (showBusy) setBusy(true);
    try { return {ok:true,value:await task()}; }
    catch (err) { setFailure(err.code === 'permission-denied' ? 'Firebase에 새 메모·폴더 규칙을 적용해 주세요.' : err.message || '저장하지 못했습니다. 연결을 확인해 주세요.'); return {ok:false}; }
    finally { if (showBusy) setBusy(false); }
  }
  async function addNote() {
    const result = await run(() => library.create(currentFolder?.id || null));
    if (result.ok) {
      remember(result.value); setSelectedId(result.value); setSearch('');
    }
  }
  async function saveFolder(event) {
    event.preventDefault();
    const result = await run(() => library.saveFolder(folderForm.id,folderForm.name,folderForm.parentId ?? null));
    if (result.ok) { if (folderForm.parentId) setFolderOpen(folderForm.parentId,true); selectFolder(result.value); setFolderForm(null); }
  }
  async function removeFolder(item) {
    const descendants = folderDescendantIds(folders,item.id), ids = [item.id,...descendants];
    const counted = ids.every(id => Number.isFinite(library.counts?.[id]));
    const noteCount = counted ? ids.reduce((sum,id) => sum + library.counts[id],0)
      : notes.filter(note => !note.archived && ids.includes(note.folderId)).length;
    if (!window.confirm(`'${item.name}' 폴더를 삭제할까요?\n하위 폴더 ${descendants.length}개, 메모 ${noteCount}개${counted ? '' : ' 이상'}가 함께 영구 삭제됩니다.\n휴지통이 없어 되돌릴 수 없습니다.`)) return;
    const result = await run(() => library.deleteFolder(ids));
    if (result.ok) { if (ids.includes(folder)) selectFolder(ALL_NOTES); setMenu(null); }
  }
  async function dropFolder(event,item) {
    event.preventDefault();
    if (!draggedId || !dropTarget || busy) return;
    const move = folderMove(displayFolders,draggedId,item.id,dropTarget.position);
    setDraggedId(null);setDropTarget(null);
    if (!move) return;
    if (move.parentId) setFolderOpen(move.parentId,true);
    setPendingMove(move);
    await run(() => library.moveFolder(move));
    setPendingMove(null);
  }
  const folderButton = (id,label,count,item) => <button type="button" className={`notes-folder-button${activeFolder === id ? ' is-selected' : ''}`}
    draggable={!!item && !busy} title={item ? '드래그하여 순서 변경 · 다른 폴더 가운데에 놓으면 그 안으로 이동 · 우클릭하여 관리' : undefined}
    onDragStart={item ? event => {
      setMenu(null);setDraggedId(id);event.dataTransfer.effectAllowed = 'move';event.dataTransfer.setData('application/x-planer-folder',id);
    } : undefined} onDragEnd={() => {setDraggedId(null);setDropTarget(null);}}
    aria-haspopup={item ? 'menu' : undefined} onContextMenu={item ? event => {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({item,trigger:event.currentTarget,x:Math.max(8,Math.min(event.clientX || rect.left,window.innerWidth - 148)),
        y:Math.max(8,Math.min(event.clientY || rect.bottom,window.innerHeight - 120))});
    } : undefined} onClick={() => selectFolder(id)}><span>{label}</span><small>{count}</small></button>;
  return <section className="notes-page" aria-labelledby="notes-title">
    <div className="notes-heading"><div><h1 id="notes-title">메모</h1><p>메모를 나누어 적고 폴더로 정리하세요.</p></div>
      <button type="button" className="notes-primary-button" disabled={busy || loading || !!error} onClick={addNote}>＋ 새 메모</button>
    </div>
    {(error || failure) && <div className="notes-notice" role="alert"><span>{failure || (error.code === 'permission-denied'
      ? '메모와 폴더를 사용하려면 Firebase에 새 메모·폴더 규칙을 적용해 주세요.' : '메모 목록을 불러오지 못했습니다. 연결 상태를 확인해 주세요.')}</span>
      {error && <button type="button" onClick={library.retry}>다시 연결</button>}</div>}
    <div className="notes-workspace">
      <aside className="notes-folders" aria-label="메모 폴더 목록">
        <div className="notes-sidebar-heading"><h2>폴더</h2><button type="button" aria-label="새 폴더" title="새 폴더" disabled={busy || loading || !!error}
          onClick={() => setFolderForm({id:null,name:'',parentId:null})}>＋</button></div>
        {folderForm && <form className="notes-folder-form" onSubmit={saveFolder}>
          {folderForm.parentId && <p>'{folders.find(item => item.id === folderForm.parentId)?.name}' 안에 만들기</p>}
          <input aria-label="폴더 이름" placeholder="폴더 이름" autoFocus maxLength={80} required value={folderForm.name}
            onChange={event => setFolderForm({...folderForm,name:event.target.value})} />
          <div><button type="submit" disabled={busy || !folderForm.name.trim()}>저장</button><button type="button" onClick={() => setFolderForm(null)}>취소</button></div>
        </form>}
        <div className="notes-folder-list">
          {folderButton(ALL_NOTES,'전체 메모',library.counts?.all ?? '…')}
          {shownRows.map(({folder:item,depth,hasChildren}) => { const open = !collapsedIds.has(item.id);
            return <div className={`notes-folder-entry${draggedId === item.id ? ' is-dragging' : ''}${dropTarget?.id === item.id ? ` drop-${dropTarget.position}` : ''}`} key={item.id}
            style={{'--indent':`${(depth-1)*14}px`}} data-depth={depth}
            onDragOver={event => {
              if (!draggedId || busy || draggedId === item.id) return;
              const position = dropPosition(event);
              if (!folderMove(displayFolders,draggedId,item.id,position)) { setDropTarget(null); return; }
              event.preventDefault();event.dataTransfer.dropEffect = 'move';
              setDropTarget(previous => previous?.id === item.id && previous.position === position ? previous : {id:item.id,position});
            }} onDragLeave={event => {if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null);}}
            onDrop={event => dropFolder(event,item)}>
            {hasChildren ? <button type="button" className="notes-folder-toggle" aria-expanded={open}
              aria-label={`${item.name} 하위 폴더 ${open ? '접기' : '펼치기'}`} onClick={() => setFolderOpen(item.id,!open)}>{open ? '▾' : '▸'}</button>
              : <span className="notes-folder-toggle" aria-hidden="true" />}
            {folderButton(item.id,item.name,library.counts?.[item.id] ?? '…',item)}
          </div>; })}
        </div>
        <NotesHelp />
      </aside>
      <aside className="notes-list" aria-label="메모 목록">
        <h2>{folderName}<small>{searching ? visible.length : library.counts?.[activeFolder] ?? visible.length}</small></h2>
        <input className="notes-search" aria-label="메모 제목 검색" placeholder="제목 검색" value={search} onChange={event => {remember();setSearch(event.target.value);}} />
        {loading ? <p className="notes-empty" role="status">{searching ? '전체 메모에서 검색하는 중…' : '불러오는 중…'}</p> : visible.length ? <ul>{visible.map(note => <li key={note.id}>
          <button type="button" className={`notes-list-item${selected?.id === note.id ? ' is-selected' : ''}`} onClick={() => selectNote(note.id)}>
            <strong>{note.title}</strong><span>{note.id === 'legacy' ? '이전에 작성한 메모' : notePlainText(note.text).trim().split('\n')[0] || '내용을 입력해 보세요.'}</span>
          </button></li>)}</ul> : <p className="notes-empty">{search ? '검색 결과가 없습니다.' : '아직 메모가 없습니다.'}</p>}
        {!loading && !searching && library.hasMore && <button type="button" className="notes-load-more"
          disabled={library.loadingMore || !!error} onClick={library.loadMore}>{library.loadingMore ? '불러오는 중…' : '더 보기'}</button>}
      </aside>
      <div className="notes-editor-pane">
        {editors.map(id => { const note = notes.find(item => item.id === id); const isActive = selected?.id === id; return note &&
          <NoteEditorActiveProvider key={id} active={isActive}>
            <div hidden={!isActive}>{renderEditor(note,run,isActive)}</div>
          </NoteEditorActiveProvider>; })}
        {!selected && <div className="notes-editor-empty"><span aria-hidden="true">📝</span><p>메모를 선택하거나 새 메모를 만들어 보세요.</p>
          <button type="button" disabled={busy || loading || !!error} onClick={addNote}>새 메모 만들기</button></div>}
      </div>
    </div>
    {menu && createPortal(<div ref={menuRef} className="notes-folder-menu" role="menu" aria-label={`${menu.item.name} 폴더 관리`}
      style={{left:menu.x,top:menu.y}}>
      <button type="button" role="menuitem" disabled={busy || folderDepth(menu.item.id) >= MAX_FOLDER_DEPTH}
        title={folderDepth(menu.item.id) >= MAX_FOLDER_DEPTH ? `폴더는 ${MAX_FOLDER_DEPTH}단계까지 만들 수 있습니다.` : undefined}
        onClick={() => {setFolderForm({id:null,name:'',parentId:menu.item.id});setMenu(null);}}>하위 폴더 만들기</button>
      <button type="button" role="menuitem" onClick={() => {setFolderForm({id:menu.item.id,name:menu.item.name});setMenu(null);}}>이름 변경</button>
      <button type="button" role="menuitem" disabled={busy} onClick={() => {const item = menu.item;setMenu(null);removeFolder(item);}}>폴더 삭제</button>
    </div>,document.body)}
  </section>;
}
