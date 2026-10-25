import { collection, doc, limit, onSnapshot, orderBy, query, startAfter, where } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { createNoteSnapshotHub } from './noteSnapshotHub.mjs';

const hub=createNoteSnapshotHub((uid,next,error,{folder,all,cursor,pageSize})=>{
  const ref=collection(db,'notepads',uid,'notes');
  const constraints=[orderBy('updatedAt','desc')];
  if (folder !== 'all') constraints.push(where('folderId','==',folder));
  if (!all) constraints.push(limit(pageSize));
  if (cursor) constraints.push(startAfter(cursor));
  let active=true,compatibilityStop;
  const stop=onSnapshot(query(ref,...constraints),{includeMetadataChanges:true},next,failure=>{
    if (!active) return;
    if (folder === 'all' || failure.code !== 'failed-precondition') {error?.(failure);return;}
    // Until the optional folder/sort index is available, preserve folder access
    // using its existing equality index. The default whole-library view stays bounded.
    const compare=(a,b)=>{
      const x=a.data().updatedAt,y=b.data().updatedAt;
      return (y?.seconds ?? 0)-(x?.seconds ?? 0) || (y?.nanoseconds ?? 0)-(x?.nanoseconds ?? 0)
        || (a.id === b.id ? 0 : a.id < b.id ? 1 : -1);
    };
    compatibilityStop=onSnapshot(query(ref,where('folderId','==',folder)),{includeMetadataChanges:true},snapshot=>{
      if (!active) return;
      const ordered=[...snapshot.docs].sort(compare);
      const remaining=cursor ? ordered.filter(document=>compare(document,cursor)>0) : ordered;
      next({metadata:snapshot.metadata,docs:all ? remaining : remaining.slice(0,pageSize)});
    },error);
  });
  return ()=>{active=false;stop();compatibilityStop?.();};
},{listenBody:(uid,id,next,error)=>onSnapshot(doc(db,'notepads',uid,'notes',id),{includeMetadataChanges:true},snapshot=>
  next(snapshot.exists() ? snapshot : null),error)});

export const subscribeNoteList=(...args)=>hub.subscribePage(...args);
export const subscribeNoteBody=(...args)=>hub.subscribeBody(...args);
export const getNoteLibrarySnapshot=(...args)=>hub.serverNotes(...args);
export const setNoteLibraryView=(...args)=>hub.setView(...args);
export const loadMoreNotes=(...args)=>hub.loadMore(...args);
