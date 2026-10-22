import { collection, doc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase/config';

const notesRef = uid => collection(db,'notepads',uid,'notes');
const foldersRef = uid => collection(db,'notepads',uid,'folders');
const subscribe = ref => (uid,onData,onError) => onSnapshot(ref(uid),snapshot =>
  onData(snapshot.docs.map(item => ({...item.data(),id:item.id}))),onError);
export const subscribeNotes = subscribe(notesRef);
export const subscribeNoteFolders = subscribe(foldersRef);

// The legacy editor keeps its original cloud document and local draft key.
// Only its library entry is added, once, without copying or replacing its body.
export function initializeNoteLibrary(uid,hasLegacyDraft) {
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

export async function purgeArchivedNotes(uid) {
  const snapshot = await getDocs(query(notesRef(uid),where('archived','==',true)));
  const removed = [];
  for (const note of snapshot.docs) if (await deleteNote(uid,note.id,true)) removed.push(note.id);
  return removed;
}
export async function saveNoteFolder(uid,id,name) {
  const value = name.trim();
  if (!value || value.length > 80) throw new Error('폴더 이름은 1~80자로 입력해 주세요.');
  const ref = id ? doc(foldersRef(uid),id) : doc(foldersRef(uid));
  if (id) await updateDoc(ref,{name:value,updatedAt:serverTimestamp()});
  else await setDoc(ref,{uid,name:value,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  return ref.id;
}
export async function deleteNoteFolder(uid,id,notes) {
  const children = notes.filter(note => note.folderId === id);
  // Metadata-only moves preserve both the text and any pending editor save.
  for (let offset=0;offset<children.length;offset+=400) {
    const batch = writeBatch(db);
    for (const note of children.slice(offset,offset+400))
      batch.update(doc(notesRef(uid),note.id),{folderId:null,updatedAt:serverTimestamp()});
    await batch.commit();
  }
  const batch = writeBatch(db); batch.delete(doc(foldersRef(uid),id)); await batch.commit();
}

export async function reorderNoteFolders(uid,ids) {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id || id.includes('/')))
    throw new Error('폴더 순서를 확인해 주세요.');
  for (let offset=0;offset<ids.length;offset+=400) {
    const batch = writeBatch(db);
    ids.slice(offset,offset+400).forEach((id,index) => batch.update(doc(foldersRef(uid),id),{
      sortOrder:offset+index,updatedAt:serverTimestamp(),
    }));
    await batch.commit();
  }
}
