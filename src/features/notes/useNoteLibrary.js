import { useEffect, useState } from 'react';
import { useCollection } from '../../lib/useCollection';
import { createNote, deleteNote, deleteNoteFolder, initializeNoteLibrary, moveNote, purgeArchivedNotes, renameNote, reorderNoteFolders, saveNoteFolder,
  subscribeNoteFolders, subscribeNotes } from './noteLibraryService';
import { sortedNoteFolders } from './noteLibrary.mjs';
import { noteDraftKey } from './notepadStore.mjs';

const clearDraft = (uid,id) => {try {window.localStorage.removeItem(noteDraftKey(uid,id));} catch { /* Cloud deletion is authoritative. */ }};

export function useNoteLibrary(uid) {
  const [listeners,setListeners] = useState(() => ({notes:subscribeNotes,folders:subscribeNoteFolders}));
  const [notes,notesReady,notesError] = useCollection(uid,listeners.notes);
  const [folders,foldersReady,foldersError] = useCollection(uid,listeners.folders);
  const [initialization,setInitialization] = useState({ready:false,error:null});
  useEffect(() => {
    let active = true, hasDraft = false;
    try { hasDraft = window.localStorage.getItem(`planer:notepad-draft:${uid}`) !== null; } catch { /* The editor reports unavailable local storage. */ }
    initializeNoteLibrary(uid,hasDraft).then(status => {
      if (status?.legacyDeleted) clearDraft(uid,'legacy');
      return purgeArchivedNotes(uid);
    }).then(ids => {
      ids.forEach(id => clearDraft(uid,id));
      if (active) setInitialization({ready:true,error:null});
    }).catch(error => { if (active) setInitialization({ready:true,error}); });
    return () => { active = false; };
  },[uid,listeners]);
  return {notes,folders:sortedNoteFolders(folders),
    loading:!notesReady || !foldersReady || !initialization.ready,
    error:notesError || foldersError || initialization.error,
    retry:() => {
      setInitialization({ready:false,error:null});
      setListeners({notes:(...args) => subscribeNotes(...args),folders:(...args) => subscribeNoteFolders(...args)});
    },
    create:folderId => createNote(uid,folderId),rename:(id,title) => renameNote(uid,id,title),
    move:(id,folderId) => moveNote(uid,id,folderId),remove:async id => {await deleteNote(uid,id);clearDraft(uid,id);},
    saveFolder:(id,name) => saveNoteFolder(uid,id,name),deleteFolder:id => deleteNoteFolder(uid,id,notes),
    reorderFolders:ids => reorderNoteFolders(uid,ids),
  };
}
