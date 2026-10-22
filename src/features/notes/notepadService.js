import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { MAX_NOTE_LENGTH } from './notepadStore.mjs';

const refFor = (uid,noteId) => noteId === 'legacy' ? doc(db,'notepads',uid) : doc(db,'notepads',uid,'notes',noteId);
const read = (snapshot,noteId = 'legacy') => ({text:snapshot.data()?.text ?? '',revision:snapshot.data()?.revision ?? 0,
  deleted:snapshot.data()?.deleted === true || (noteId !== 'legacy' && !snapshot.exists())});

export const subscribeNotepad = (uid,onData,onError,noteId = 'legacy') => onSnapshot(refFor(uid,noteId),snapshot => {
  if (!snapshot.metadata.hasPendingWrites) onData(read(snapshot,noteId));
},onError);

export function saveNotepad(uid,text,revision,noteId = 'legacy') {
  if (!uid || typeof text !== 'string' || text.length > MAX_NOTE_LENGTH || !Number.isInteger(revision))
    throw new Error('메모 내용을 확인해 주세요.');
  return runTransaction(db,async transaction => {
    const ref = refFor(uid,noteId), snapshot = await transaction.get(ref), remote = read(snapshot,noteId);
    if (remote.deleted) throw Object.assign(new Error('삭제된 메모입니다.'),{code:'notepad/deleted'});
    if (noteId !== 'legacy' && !snapshot.exists()) throw new Error('메모를 찾지 못했습니다.');
    if (remote.revision !== revision) {
      const error = new Error('다른 창에서 메모가 변경되었습니다.');
      error.code = 'notepad/conflict'; error.remote = remote; throw error;
    }
    const patch = {text,revision:revision+1,updatedAt:serverTimestamp()};
    if (noteId === 'legacy') transaction.set(ref,{uid,...patch});
    else transaction.update(ref,patch);
    return revision+1;
  });
}
