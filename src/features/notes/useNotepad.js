import { useEffect, useState, useSyncExternalStore } from 'react';
import { createNotepadStore } from './notepadStore.mjs';
import { saveNotepad, subscribeNotepad } from './notepadService';

export function useNotepad(uid,noteId = 'legacy') {
  const [store] = useState(() => createNotepadStore({uid,noteId,
    subscribe:(owner,onData,onError) => subscribeNotepad(owner,onData,onError,noteId),
    save:(owner,text,revision) => saveNotepad(owner,text,revision,noteId),storage:{
    getItem:key => window.localStorage.getItem(key),
    setItem:(key,value) => window.localStorage.setItem(key,value),
    removeItem:key => window.localStorage.removeItem(key),
  }}));
  const state = useSyncExternalStore(store.subscribe,store.getSnapshot);
  useEffect(() => store.start(),[store]);
  useEffect(() => {
    const retry = () => { if (store.getSnapshot().error) store.retry(); };
    window.addEventListener('online',retry);
    return () => window.removeEventListener('online',retry);
  },[store]);
  return {...state,edit:store.edit,retry:store.retry,resolveConflict:store.resolveConflict,remove:store.remove};
}
