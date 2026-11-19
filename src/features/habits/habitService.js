import {
  collection, addDoc, doc, updateDoc, deleteField, FieldPath,
  query, where, onSnapshot, serverTimestamp, getDocs, writeBatch,
} from "firebase/firestore";
import { db } from "../../firebase/config";
import { dayKey, isDay, isValidLog } from "./habitCore.mjs";

// 새벽 5시 기준으로 하루가 바뀜 (다른 화면도 이 함수를 쓴다)
export const todayStr = () => dayKey();

// 습관 기록은 습관 문서의 logs 맵({ 'YYYY-MM-DD': 'full' | 'tiny' | 'skip' | 횟수 })에 둔다.
// 하루 한 칸이라 중복 기록이 생기지 않고, 습관 구독 하나로 기록까지 모두 받는다(1년에 약 7KB).
export const subscribeHabits = (uid, cb, onError) =>
  onSnapshot(
    query(collection(db, "habits"), where("uid", "==", uid)),
    (snap) => cb(snap.docs
      .map((d) => ({ id: d.id, logs: {}, ...d.data() }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0))),
    onError
  );

export const addHabit = (uid, value) =>
  addDoc(collection(db, "habits"), {
    ...value, uid, logs: {}, archived: false, order: Date.now(), createdAt: serverTimestamp(),
  });

export const updateHabit = (habitId, value) =>
  updateDoc(doc(db, "habits", habitId), { ...value, updatedAt: serverTimestamp() });

export const setArchived = (habitId, archived) =>
  updateDoc(doc(db, "habits", habitId), { archived, updatedAt: serverTimestamp() });

// value가 null이면 그날 기록을 지운다.
export const setHabitLog = (habitId, day, value) => {
  if (!isDay(day) || !isValidLog(value)) throw new Error("Invalid habit log");
  return updateDoc(doc(db, "habits", habitId), new FieldPath("logs", day), value ?? deleteField());
};

// 예전 구조(habitLogs 컬렉션)에 남은 기록이 있으면 함께 지운다.
export const deleteHabit = async (uid, habitId) => {
  const batch = writeBatch(db);
  const snap = await getDocs(query(collection(db, "habitLogs"), where("uid", "==", uid), where("habitId", "==", habitId)));
  snap.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, "habits", habitId));
  return batch.commit();
};
