import {
  collection, addDoc, deleteDoc, doc, query, where, onSnapshot,
  serverTimestamp, updateDoc, writeBatch, getDocs,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { controlColor } from './controlColors.mjs';
import { isControlBlock, isStudyBlock } from './blockKind.mjs';
import { subscribeAllBlocks } from './plannerService';

export const subscribeControlActivities = (uid, cb, onError) => onSnapshot(
  query(collection(db, 'controlActivities'), where('uid', '==', uid)),
  snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) =>
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
    || (a.createdAt?.seconds ?? Number.MAX_SAFE_INTEGER) - (b.createdAt?.seconds ?? Number.MAX_SAFE_INTEGER))),
  onError,
);

export const subscribeControlBlocks = (uid, dates, cb, onError) =>
  subscribeAllBlocks(uid, dates, blocks => cb(blocks.filter(isControlBlock)), onError);

export async function readStudyBlocks(uid, dates) {
  const uniqueDates = [...new Set(dates)];
  const groups = [];
  for (let i = 0; i < uniqueDates.length; i += 30) groups.push(uniqueDates.slice(i, i + 30));
  const snapshots = await Promise.all(groups.map(group => getDocs(query(
    collection(db, 'scheduleBlocks'), where('uid', '==', uid), where('date', 'in', group),
  ))));
  return snapshots.flatMap(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(isStudyBlock));
}

// Copy and delete each legacy record in the same batch so an interrupted migration can be retried.
export async function migrateLegacyControlBlocks(uid) {
  if (!uid) return;
  const snapshot = await getDocs(query(collection(db, 'controlBlocks'), where('uid', '==', uid)));
  for (let offset = 0; offset < snapshot.docs.length; offset += 200) {
    const batch = writeBatch(db);
    for (const oldDoc of snapshot.docs.slice(offset, offset + 200)) {
      batch.set(doc(db, 'scheduleBlocks', `legacy-control-${uid}-${oldDoc.id}`), {
        ...oldDoc.data(), kind: 'control',
      });
      batch.delete(oldDoc.ref);
    }
    await batch.commit();
  }
}

export const addControlActivity = (uid, data) =>
  addDoc(collection(db, 'controlActivities'), { ...data, uid, createdAt: serverTimestamp() });
export const archiveControlActivity = id => updateDoc(doc(db, 'controlActivities', id), {
  archived: true, archivedAt: serverTimestamp(),
});
export const changeControlActivityGroup = (id, group) =>
  updateDoc(doc(db, 'controlActivities', id), { group, color: controlColor(group) });
export const updateControlActivityOrder = ids => {
  const batch = writeBatch(db);
  ids.forEach((id, order) => batch.update(doc(db, 'controlActivities', id), { order }));
  return batch.commit();
};
export const addControlBlock = (uid, data) =>
  addDoc(collection(db, 'scheduleBlocks'), { ...data, uid, kind: 'control', createdAt: serverTimestamp() });
export const deleteControlBlock = id => deleteDoc(doc(db, 'scheduleBlocks', id));
export const saveControlTimer = (uid, { startTs, segments, metadata }) => {
  const batch = writeBatch(db);
  segments.forEach((segment, index) => batch.set(doc(db, 'scheduleBlocks', `control_${uid}_timer_${startTs}_${index}`), {
    ...metadata, ...segment, uid, kind: 'control', createdAt: serverTimestamp(),
  }));
  return segments.length ? batch.commit() : Promise.resolve();
};
