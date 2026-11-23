import { collection, doc, getCountFromServer, getDocs, onSnapshot, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getNoteLibrarySnapshot, subscribeNoteList } from './noteSubscriptions';

const notesRef = uid => collection(db,'notepads',uid,'notes');
const foldersRef = uid => collection(db,'notepads',uid,'folders');
const subscribe = ref => (uid,onData,onError) => onSnapshot(ref(uid),snapshot =>
  onData(snapshot.docs.map(item => ({...item.data(),id:item.id}))),onError);
export const subscribeNotes = (...args) => subscribeNoteList(...args);
export const subscribeNoteFolders = subscribe(foldersRef);

// The legacy editor keeps its original cloud document and local draft key.
// Only its library entry is added, once, without copying or replacing its body.
export function initializeNoteLibrary(uid,hasLegacyDraft,notes) {
  if (notes?.some(note => note.id === 'legacy')) return Promise.resolve();
  return runTransaction(db,async transaction => {
    const legacyRef = doc(notesRef(uid),'legacy');
    const entry = await transaction.get(legacyRef);
    if (entry.exists()) return;
    const original = await transaction.get(doc(db,'notepads',uid));
    if (original.data()?.deleted) return {legacyDeleted:true};
    if (original.exists() || hasLegacyDraft) {
      transaction.set(legacyRef,{uid,title:'기존 메모',text:'',revision:0,folderId:null,archived:false,
        createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    }
  });
}

export async function createNote(uid,folderId = null) {
  const ref = doc(notesRef(uid));
  await setDoc(ref,{uid,title:'새 메모',text:'',revision:0,folderId,archived:false,
    createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  return ref.id;
}
export function renameNote(uid,id,title) {
  const value = title.trim() || '제목 없는 메모';
  if (value.length > 120) throw new Error('메모 제목은 120자까지 입력해 주세요.');
  return updateDoc(doc(notesRef(uid),id),{title:value,updatedAt:serverTimestamp()});
}
export const moveNote = (uid,id,folderId) => updateDoc(doc(notesRef(uid),id),{folderId,updatedAt:serverTimestamp()});
export function deleteNote(uid,id,archivedOnly = false) {
  return runTransaction(db,async transaction => {
    const ref = doc(notesRef(uid),id), snapshot = await transaction.get(ref);
    if (archivedOnly && (!snapshot.exists() || !snapshot.data().archived)) return false;
    if (id === 'legacy') {
      const originalRef = doc(db,'notepads',uid), original = await transaction.get(originalRef);
      // The empty marker prevents an old window or stale draft from recreating the legacy note.
      if (!original.data()?.deleted) transaction.set(originalRef,{uid,text:'',revision:(original.data()?.revision || 0)+1,
        deleted:true,updatedAt:serverTimestamp()});
    }
    transaction.delete(ref);
    return true;
  });
}

export async function purgeArchivedNotes(uid,notes) {
  const archived = notes ? notes.filter(note => note.archived)
    : (await getDocs(query(notesRef(uid),where('archived','==',true)))).docs;
  const removed = [];
  for (const note of archived) if (await deleteNote(uid,note.id,true)) removed.push(note.id);
  return removed;
}

export async function prepareNoteLibrary(uid,hasLegacyDraft,options) {
  const notes=await getNoteLibrarySnapshot(uid,options);
  const status=await initializeNoteLibrary(uid,hasLegacyDraft,notes);
  // A paginated inventory cannot establish that older archived records are absent.
  const removed=await purgeArchivedNotes(uid);
  return {legacyDeleted:status?.legacyDeleted === true,removed};
}
export async function getNoteCounts(uid,folderIds) {
  const scopes=['all',...folderIds];
  const results=await Promise.all(scopes.map(async id=>{
    const filters=[where('archived','==',false)];
    if (id !== 'all') filters.push(where('folderId','==',id));
    const result=await getCountFromServer(query(notesRef(uid),...filters));
    return [id,result.data().count];
  }));
  return Object.fromEntries(results);
}
export async function saveNoteFolder(uid,id,name,parentId = null) {
  const value = name.trim();
  if (!value || value.length > 80) throw new Error('폴더 이름은 1~80자로 입력해 주세요.');
  const ref = id ? doc(foldersRef(uid),id) : doc(foldersRef(uid));
  if (id) await updateDoc(ref,{name:value,updatedAt:serverTimestamp()});
  else await setDoc(ref,{uid,name:value,parentId,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  return ref.id;
}

const validFolderIds = ids => Array.isArray(ids) && new Set(ids).size === ids.length
  && ids.every(id => typeof id === 'string' && id && !id.includes('/'));

// Deletes the folder, every descendant folder and all notes directly inside any of them.
// Notes go first, so an interrupted run leaves the folders in place to retry.
export async function deleteNoteFolder(uid,ids) {
  if (!validFolderIds(ids) || !ids.length) throw new Error('삭제할 폴더를 확인해 주세요.');
  const removed = [];
  for (const id of ids) {
    const notes = (await getDocs(query(notesRef(uid),where('folderId','==',id)))).docs.map(item => item.id);
    // The legacy note needs its original document marked deleted as well.
    if (notes.includes('legacy') && await deleteNote(uid,'legacy')) removed.push('legacy');
    const others = notes.filter(note => note !== 'legacy');
    for (let offset=0;offset<others.length;offset+=400) {
      const batch = writeBatch(db);
      for (const note of others.slice(offset,offset+400)) batch.delete(doc(notesRef(uid),note));
      await batch.commit();
    }
    removed.push(...others);
  }
  for (let offset=0;offset<ids.length;offset+=400) {
    const batch = writeBatch(db);
    for (const id of [...ids].reverse().slice(offset,offset+400)) batch.delete(doc(foldersRef(uid),id));
    await batch.commit();
  }
  return removed;
}

export async function reorderNoteFolders(uid,ids,moved = null) {
  if (!validFolderIds(ids) || (moved && (!ids.includes(moved.id) || (moved.parentId !== null && !validFolderIds([moved.parentId])))))
    throw new Error('폴더 순서를 확인해 주세요.');
  for (let offset=0;offset<ids.length;offset+=400) {
    const batch = writeBatch(db);
    ids.slice(offset,offset+400).forEach((id,index) => batch.update(doc(foldersRef(uid),id),{
      sortOrder:offset+index,...(moved?.id === id ? {parentId:moved.parentId} : {}),updatedAt:serverTimestamp(),
    }));
    await batch.commit();
  }
}

export const moveNoteFolder = (uid,{id,parentId,ids}) => reorderNoteFolders(uid,ids,{id,parentId});
