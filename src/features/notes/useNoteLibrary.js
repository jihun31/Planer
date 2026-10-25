import { useCallback, useEffect, useRef, useState } from 'react';
import { useCollection } from '../../lib/useCollection';
import { createNote, deleteNote, deleteNoteFolder, getNoteCounts, moveNote, prepareNoteLibrary, renameNote, reorderNoteFolders, saveNoteFolder,
  subscribeNoteFolders, subscribeNotes } from './noteLibraryService';
import { sortedNoteFolders } from './noteLibrary.mjs';
import { noteDraftKey } from './notepadStore.mjs';
import { loadMoreNotes, setNoteLibraryView } from './noteSubscriptions';

const clearDraft = (uid,id) => {try {window.localStorage.removeItem(noteDraftKey(uid,id));} catch { /* Cloud deletion is authoritative. */ }};

export function useNoteLibrary(uid) {
  const [listeners,setListeners] = useState(() => ({notes:subscribeNotes,folders:subscribeNoteFolders}));
  const [page,notesReady,notesError] = useCollection(uid,listeners.notes);
  const [folders,foldersReady,foldersError] = useCollection(uid,listeners.folders);
  const [initialization,setInitialization] = useState({ready:false,error:null});
  const [countState,setCountState]=useState(null);
  const countRequest=useRef(null);
  const pageNotes=page.notes || [], notes=page.documents || [];
  const folderKey=folders.map(folder=>folder.id).sort().join('|');
  const membershipKey=pageNotes.map(note=>`${note.id}:${note.folderId ?? ''}`).sort().join('|');
  const setView=useCallback((folder,all)=>setNoteLibraryView(uid,folder,all),[uid]);
  const loadMore=useCallback(()=>loadMoreNotes(uid),[uid]);
  useEffect(()=>{
    if (!notesReady || !foldersReady || !page.serverReady) return;
    let active=true;
    const timer=setTimeout(()=>{
      const key=JSON.stringify([uid,folderKey,membershipKey]);
      if (countRequest.current?.key !== key || countRequest.current.listeners !== listeners)
        countRequest.current={key,listeners,promise:getNoteCounts(uid,folderKey ? folderKey.split('|') : [])};
      const request=countRequest.current;
      request.promise.then(counts=>{
        if (active) setCountState({uid,counts});
      }).catch(()=>{if (countRequest.current === request) countRequest.current=null;});
    },100);
    return ()=>{active=false;clearTimeout(timer);};
  },[uid,notesReady,foldersReady,page.serverReady,folderKey,membershipKey,listeners]);
  useEffect(() => {
    let active = true, hasDraft = false;
    const controller=new AbortController();
    try { hasDraft = window.localStorage.getItem(`planer:notepad-draft:${uid}`) !== null; } catch { /* The editor reports unavailable local storage. */ }
    prepareNoteLibrary(uid,hasDraft,{signal:controller.signal}).then(({legacyDeleted,removed}) => {
      if (legacyDeleted) clearDraft(uid,'legacy');
      removed.forEach(id => clearDraft(uid,id));
      if (active) setInitialization({ready:true,error:null});
    }).catch(error => { if (active) setInitialization({ready:true,error}); });
    return () => { active = false;controller.abort(); };
  },[uid,listeners]);
  return {notes,pageNotes,folders:sortedNoteFolders(folders),setView,loadMore,
    counts:countState?.uid === uid ? countState.counts : {},
    pageFolder:page.folder,searchAll:page.all,hasMore:page.hasMore,loadingMore:page.loadingMore,
    loading:!notesReady || !page.ready || !foldersReady || !initialization.ready,
    error:notesError || foldersError || initialization.error,
    retry:() => {
      setInitialization({ready:false,error:null});
      setListeners({notes:(...args) => subscribeNotes(...args),folders:(...args) => subscribeNoteFolders(...args)});
    },
    create:folderId => createNote(uid,folderId),rename:(id,title) => renameNote(uid,id,title),
    move:(id,folderId) => moveNote(uid,id,folderId),remove:async id => {await deleteNote(uid,id);clearDraft(uid,id);},
    saveFolder:(id,name) => saveNoteFolder(uid,id,name),deleteFolder:id => deleteNoteFolder(uid,id),
    reorderFolders:ids => reorderNoteFolders(uid,ids),
  };
}
