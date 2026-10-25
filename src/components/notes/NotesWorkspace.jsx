import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ALL_NOTES, movedFolderIds, visibleNotes } from '../../features/notes/noteLibrary.mjs';
import { notePlainText } from '../../features/notes/noteRichText.mjs';
import { NotesHelp } from './NotesHelp.jsx';

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
  const [folderOrder,setFolderOrder] = useState(null);
  const displayFolders = folderOrder ? [...folders].sort((a,b) => {
    const position = id => {const index = folderOrder.indexOf(id);return index < 0 ? Infinity : index;};
    return position(a.id)-position(b.id);
  }) : folders;
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
  const editors = [...new Set([...opened,selected?.id].filter(Boolean))];
  const remember = id => setOpened(previous => [...new Set([...previous,selected?.id,id].filter(Boolean))]);
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
    const result = await run(() => library.saveFolder(folderForm.id,folderForm.name));
    if (result.ok) { selectFolder(result.value); setFolderForm(null); }
  }
  async function removeFolder(item) {
    if (!window.confirm(`'${item.name}' 폴더를 삭제할까요? 안의 메모는 전체 메모에 그대로 남습니다.`)) return;
    const result = await run(() => library.deleteFolder(item.id));
    if (result.ok) { if (folder === item.id) selectFolder(ALL_NOTES); setMenu(null); }
  }
  async function dropFolder(event,item) {
    event.preventDefault();
    if (!draggedId || !dropTarget || busy) return;
    const next = movedFolderIds(displayFolders,draggedId,item.id,dropTarget.after);
    setDraggedId(null);setDropTarget(null);
    if (next.every((id,index) => id === displayFolders[index].id)) return;
    setFolderOrder(next);
    await run(() => library.reorderFolders(next));
    setFolderOrder(null);
  }
  const folderButton = (id,label,count,item) => <button type="button" className={`notes-folder-button${activeFolder === id ? ' is-selected' : ''}`}
    draggable={!!item && !busy} title={item ? '드래그하여 순서 변경 · 우클릭하여 관리' : undefined}
    onDragStart={item ? event => {
      setMenu(null);setDraggedId(id);event.dataTransfer.effectAllowed = 'move';event.dataTransfer.setData('application/x-planer-folder',id);
    } : undefined} onDragEnd={() => {setDraggedId(null);setDropTarget(null);}}
    aria-haspopup={item ? 'menu' : undefined} onContextMenu={item ? event => {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({item,trigger:event.currentTarget,x:Math.max(8,Math.min(event.clientX || rect.left,window.innerWidth - 148)),
        y:Math.max(8,Math.min(event.clientY || rect.bottom,window.innerHeight - 90))});
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
          onClick={() => setFolderForm({id:null,name:''})}>＋</button></div>
        {folderForm && <form className="notes-folder-form" onSubmit={saveFolder}>
          <input aria-label="폴더 이름" placeholder="폴더 이름" autoFocus maxLength={80} required value={folderForm.name}
            onChange={event => setFolderForm({...folderForm,name:event.target.value})} />
          <div><button type="submit" disabled={busy || !folderForm.name.trim()}>저장</button><button type="button" onClick={() => setFolderForm(null)}>취소</button></div>
        </form>}
        <div className="notes-folder-list">
          {folderButton(ALL_NOTES,'전체 메모',library.counts?.all ?? '…')}
          {displayFolders.map(item => <div className={`notes-folder-entry${draggedId === item.id ? ' is-dragging' : ''}${dropTarget?.id === item.id ? dropTarget.after ? ' drop-after' : ' drop-before' : ''}`} key={item.id}
            onDragOver={event => {
              if (!draggedId || busy || draggedId === item.id) return;
              event.preventDefault();event.dataTransfer.dropEffect = 'move';
              const rect = event.currentTarget.getBoundingClientRect();
              const after = window.matchMedia('(max-width:900px)').matches ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2;
              setDropTarget(previous => previous?.id === item.id && previous.after === after ? previous : {id:item.id,after});
            }} onDragLeave={event => {if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null);}}
            onDrop={event => dropFolder(event,item)}>
            {folderButton(item.id,item.name,library.counts?.[item.id] ?? '…',item)}
          </div>)}
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
        {editors.map(id => { const note = notes.find(item => item.id === id); return note &&
          <div key={id} hidden={selected?.id !== id}>{renderEditor(note,run)}</div>; })}
        {!selected && <div className="notes-editor-empty"><span aria-hidden="true">📝</span><p>메모를 선택하거나 새 메모를 만들어 보세요.</p>
          <button type="button" disabled={busy || loading || !!error} onClick={addNote}>새 메모 만들기</button></div>}
      </div>
    </div>
    {menu && createPortal(<div ref={menuRef} className="notes-folder-menu" role="menu" aria-label={`${menu.item.name} 폴더 관리`}
      style={{left:menu.x,top:menu.y}}>
      <button type="button" role="menuitem" onClick={() => {setFolderForm({id:menu.item.id,name:menu.item.name});setMenu(null);}}>이름 변경</button>
      <button type="button" role="menuitem" disabled={busy} onClick={() => {const item = menu.item;setMenu(null);removeFolder(item);}}>폴더 삭제</button>
    </div>,document.body)}
  </section>;
}
