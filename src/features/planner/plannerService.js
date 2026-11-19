import {
  collection, addDoc, deleteDoc, doc,
  query, where, onSnapshot, serverTimestamp,
  updateDoc, writeBatch, getDocs,
} from "firebase/firestore";
import { db } from "../../firebase/config";
import { subscribeDateGroups } from "./blockSubscriptions.mjs";
import { isStudyBlock } from './blockKind.mjs';

const byOrder = (a, b) => {
  if (a.order != null && b.order != null) return a.order - b.order;
  if (a.order != null) return -1;
  if (b.order != null) return 1;
  return (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0);
};

export const subscribeActivities = (uid, cb, onError) =>
  onSnapshot(
    query(collection(db, "plannerActivities"), where("uid", "==", uid)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byOrder)),
    onError
  );

export const updateActivityOrder = (orderedIds) => {
  const batch = writeBatch(db);
  orderedIds.forEach((id, index) => {
    batch.update(doc(db, "plannerActivities", id), { order: index });
  });
  return batch.commit();
};

export const addActivity = (uid, data) =>
  addDoc(collection(db, "plannerActivities"), { ...data, uid, createdAt: serverTimestamp() });

// Records keep their own color, so recolor this activity's past records too
// (control entries and custom-named records keep theirs).
export const updateActivityColor = async (activity, color) => {
  if (!/^#[0-9a-f]{6}$/i.test(color) || !activity?.id || !activity.uid) throw new Error('activity-color');
  await updateDoc(doc(db, "plannerActivities", activity.id), { color });
  const snapshot = await getDocs(query(collection(db, "scheduleBlocks"),
    where("uid", "==", activity.uid), where("activityId", "==", activity.id)));
  const records = snapshot.docs.filter(item => {
    const data = item.data();
    return data.kind !== 'control' && !data.customName && data.activityColor !== color;
  });
  for (let index = 0; index < records.length; index += 400) {
    const batch = writeBatch(db);
    records.slice(index, index + 400).forEach(item => batch.update(item.ref, { activityColor: color }));
    await batch.commit();
  }
};

// Keep the activity metadata for historical records; hide it from new selections.
export const deleteActivity = (uid, activityId) => {
  if (!uid) throw new Error('Login required');
  return updateDoc(doc(db, "plannerActivities", activityId), {
    archived: true, archivedAt: serverTimestamp(),
  });
};

export const subscribeAllBlocks = (uid, dates, cb, onError) =>
  subscribeDateGroups(dates, (group, onData, onFailure) => onSnapshot(
    query(collection(db, "scheduleBlocks"), where("uid", "==", uid), where("date", "in", group)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onFailure,
  ), cb, onError);

export const subscribeBlocks = (uid, dates, cb, onError) =>
  subscribeAllBlocks(uid, dates, blocks => cb(blocks.filter(isStudyBlock)), onError);

export const addBlock = (uid, data) =>
  addDoc(collection(db, "scheduleBlocks"), { ...data, uid, kind: 'study', createdAt: serverTimestamp() });

export const deleteBlock = (blockId) => deleteDoc(doc(db, "scheduleBlocks", blockId));

// Stable IDs make a retry idempotent; a batch saves cross-day segments atomically.
export const saveTimer = (uid, { startTs, segments, metadata }) => {
  const batch = writeBatch(db);
  segments.forEach((segment, index) => {
    batch.set(doc(db, 'scheduleBlocks', uid + '_timer_' + startTs + '_' + index), {
      ...metadata, ...segment, uid, kind: 'study', createdAt: serverTimestamp(),
    });
  });
  return segments.length ? batch.commit() : Promise.resolve();
};
