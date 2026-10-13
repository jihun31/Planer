import {
  collection, addDoc, deleteDoc, doc,
  query, where, onSnapshot, serverTimestamp,
  getDocs, writeBatch,
} from "firebase/firestore";
import { db } from "../../firebase/config";
import { todayStr } from "../habits/habitService";

const byCreatedAt = (a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0);

export const subscribeProgressItems = (uid, cb, onError) =>
  onSnapshot(
    query(collection(db, "progressItems"), where("uid", "==", uid)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byCreatedAt)),
    onError
  );

export const addProgressItem = (uid, data) =>
  addDoc(collection(db, "progressItems"), { ...data, uid, createdAt: serverTimestamp() });

export const deleteProgressItem = async (uid, itemId) => {
  const batch = writeBatch(db);
  const snap = await getDocs(
    query(collection(db, "progressLogs"), where("uid", "==", uid), where("progressItemId", "==", itemId))
  );
  snap.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, "progressItems", itemId));
  return batch.commit();
};

export const subscribeProgressLogs = (uid, cb, onError) =>
  onSnapshot(
    query(collection(db, "progressLogs"), where("uid", "==", uid)),
    (snap) => cb(snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))),
    onError
  );

export const addProgressLog = (uid, progressItemId, goalId, note, date) =>
  addDoc(collection(db, "progressLogs"), {
    uid, progressItemId, goalId, note, date: date ?? todayStr(), createdAt: serverTimestamp(),
  });

export const deleteProgressLog = (logId) => deleteDoc(doc(db, "progressLogs", logId));
