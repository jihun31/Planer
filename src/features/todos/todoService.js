import {
  collection, addDoc, deleteDoc, doc,
  query, where, onSnapshot, serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebase/config";

export const subscribeTodos = (uid, cb, onError) =>
  onSnapshot(
    query(collection(db, "todos"), where("uid", "==", uid)),
    (snap) => cb(snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
      })),
    onError
  );

export const addTodo = (uid, data) =>
  addDoc(collection(db, "todos"), { ...data, uid, completed: false, createdAt: serverTimestamp() });

export const deleteTodo = (id) => deleteDoc(doc(db, "todos", id));

