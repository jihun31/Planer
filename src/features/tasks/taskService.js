import {
  collection, addDoc, deleteDoc, doc,
  query, where, onSnapshot, serverTimestamp, updateDoc,
} from "firebase/firestore";
import { db } from "../../firebase/config";

export const subscribeTasks = (uid, cb, onError) =>
  onSnapshot(
    query(collection(db, "tasks"), where("uid", "==", uid)),
    (snap) => cb(snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        if (!a.dueDate && !b.dueDate) return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      })),
    onError
  );

export const addTask = (uid, data) =>
  addDoc(collection(db, "tasks"), { ...data, uid, completed: false, createdAt: serverTimestamp(), createdAtMs: Date.now() });

export const deleteTask = (taskId) => deleteDoc(doc(db, "tasks", taskId));

export const toggleTask = (taskId, completed) =>
  updateDoc(doc(db, "tasks", taskId), { completed: !completed });
