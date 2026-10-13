import {
  collection, addDoc, deleteDoc, doc,
  query, where, onSnapshot, serverTimestamp,
  getDocs, writeBatch,
} from "firebase/firestore";
import { db } from "../../firebase/config";

const fmtDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// 새벽 5시 기준으로 하루가 바뀜
export const todayStr = () => {
  const d = new Date();
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  return fmtDate(d);
};

export const yesterdayStr = () => {
  const d = new Date();
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  d.setDate(d.getDate() - 1);
  return fmtDate(d);
};

export const weekRange = () => {
  const now = new Date();
  if (now.getHours() < 5) now.setDate(now.getDate() - 1);
  const diff = now.getDay() === 0 ? -6 : 1 - now.getDay();
  const mon = new Date(now); mon.setDate(now.getDate() + diff);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { start: fmtDate(mon), end: fmtDate(sun) };
};

export const monthRange = () => {
  const now = new Date();
  if (now.getHours() < 5) now.setDate(now.getDate() - 1);
  const y = now.getFullYear(), m = now.getMonth();
  return { start: fmtDate(new Date(y, m, 1)), end: fmtDate(new Date(y, m + 1, 0)) };
};

export const subscribeHabits = (uid, cb, onError) =>
  onSnapshot(
    query(collection(db, "habits"), where("uid", "==", uid)),
    (snap) => cb(snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0))),
    onError
  );

export const addHabit = (uid, data) =>
  addDoc(collection(db, "habits"), { ...data, uid, createdAt: serverTimestamp() });

export const deleteHabit = async (uid, habitId) => {
  const batch = writeBatch(db);
  const snap = await getDocs(query(collection(db, "habitLogs"), where("uid", "==", uid), where("habitId", "==", habitId)));
  snap.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, "habits", habitId));
  return batch.commit();
};

export const subscribeHabitLogs = (uid, cb, onError) =>
  onSnapshot(
    query(collection(db, "habitLogs"), where("uid", "==", uid)),
    (snap) => {
      const { start: wStart, end: wEnd } = weekRange();
      const { start: mStart, end: mEnd } = monthRange();
      const start = wStart < mStart ? wStart : mStart;
      const end   = wEnd   > mEnd   ? wEnd   : mEnd;
      cb(snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((l) => l.date >= start && l.date <= end));
    },
    onError
  );

export const checkHabit = (uid, habitId) =>
  addDoc(collection(db, "habitLogs"), {
    uid, habitId, date: todayStr(), createdAt: serverTimestamp(),
  });

export const uncheckHabit = async (habitId, logs) => {
  const today = todayStr();
  const todayLogs = logs
    .filter((l) => l.habitId === habitId && l.date === today)
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
  if (todayLogs.length > 0) await deleteDoc(doc(db, "habitLogs", todayLogs[0].id));
};
