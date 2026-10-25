import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NotesWorkspace } from '../../src/components/notes/NotesWorkspace.jsx';
import { createNoteSnapshotHub } from '../../src/features/notes/noteSnapshotHub.mjs';
import '../../src/styles/app.css';
import '../../src/styles/notes.css';
import '../../src/styles/calendar.css';

const notes=Array.from({length:45},(_,index)=>({id:`note-${index}`,title:index===44 ? '오래된 검색 대상' : `메모 ${index}`,
  text:`본문 ${index}`,revision:0,archived:false,folderId:index < 12 ? 'study' : 'older',
  updatedAt:{seconds:1000-index,nanoseconds:0,toMillis:()=>1000000-index*1000}}));
const reads=[];
const hub=createNoteSnapshotHub((_uid,next,_error,{folder,all,cursor,pageSize})=>{
  let active=true;
  const candidates=notes.filter(note=>folder === 'all' || note.folderId === folder);
  const offset=cursor ? candidates.findIndex(note=>note.id === cursor.id)+1 : 0;
  const result=candidates.slice(offset,all ? undefined : offset+pageSize);
  reads.push(result.length);
  queueMicrotask(()=>{if(active)next({metadata:{fromCache:false,hasPendingWrites:false},
    docs:result.map(note=>({id:note.id,data:()=>note,metadata:{hasPendingWrites:false}}))});});
  return ()=>{active=false;};
});
export function Preview() {
  const [page,setPage]=useState({notes:[],documents:[],ready:false,folder:'all',all:false});
  useEffect(()=>hub.subscribePage('test-user',setPage),[]);
  const setView=useCallback((folder,all)=>hub.setView('test-user',folder,all),[]);
  const loadMore=useCallback(()=>hub.loadMore('test-user'),[]);
  const library={notes:page.documents,pageNotes:page.notes,loading:!page.ready,
    folders:[{id:'study',name:'공부'},{id:'older',name:'이전 기록'}],counts:{all:45,study:12,older:33},
    pageFolder:page.folder,searchAll:page.all,hasMore:page.hasMore,loadingMore:page.loadingMore,setView,loadMore};
  return <NotesWorkspace library={library} renderEditor={note=><textarea aria-label={`${note.id} 본문`} defaultValue={note.text} />} />;
}
globalThis.noteTestReads=reads;
createRoot(document.getElementById('root')).render(<Preview />);
