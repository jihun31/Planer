import {
  collection, addDoc, deleteDoc, doc,
  query, where, onSnapshot, serverTimestamp,
  updateDoc, getDocs, writeBatch,
} from "firebase/firestore";
import { db } from "../../firebase/config";

export const GOAL_COLORS = [
  '#6366f1', '#3b82f6', '#22c55e', '#eab308', '#f97316',
  '#ef4444', '#ec4899', '#14b8a6', '#8b5cf6', '#6b7280',
];

const byCreatedAt = (a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0);
const toDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

export const subscribeGoals = (uid, cb, onError) =>
  onSnapshot(
    query(collection(db, "goals"), where("uid", "==", uid)),
    (snap) => cb(toDocs(snap).sort(byCreatedAt)),
    onError
  );

export const addGoal = (uid, title, color = GOAL_COLORS[0]) =>
  addDoc(collection(db, "goals"), { uid, title, color, createdAt: serverTimestamp() });

export const updateGoalColor = (goalId, color) =>
  updateDoc(doc(db, "goals", goalId), { color });

export const updateGoalTitle = (goalId, title) =>
  updateDoc(doc(db, "goals", goalId), { title });

export const deleteGoal = async (uid, goalId) => {
  const batch = writeBatch(db);
  const subSnap = await getDocs(query(collection(db, "subGoals"), where("uid", "==", uid), where("goalId", "==", goalId)));
  subSnap.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, "goals", goalId));
  return batch.commit();
};

export const subscribeSubGoals = (uid, cb, onError) =>
  onSnapshot(
    query(collection(db, "subGoals"), where("uid", "==", uid)),
    (snap) => cb(toDocs(snap).sort(byCreatedAt)),
    onError
  );

export const addSubGoal = (uid, goalId, data) =>
  addDoc(collection(db, "subGoals"), {
    ...data, uid, goalId, completed: false, createdAt: serverTimestamp(),
  });

export const deleteSubGoal = (subGoalId) => deleteDoc(doc(db, "subGoals", subGoalId));

export const toggleSubGoal = (subGoalId, completed) =>
  updateDoc(doc(db, "subGoals", subGoalId), { completed: !completed });
