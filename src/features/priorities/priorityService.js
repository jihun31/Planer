import { collection, doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';

const priorityRef = uid => doc(db, 'priorityNotes', uid);

export const subscribePriorityNotes = (uid, cb, onError) =>
  onSnapshot(priorityRef(uid), snapshot => {
    const items = snapshot.data()?.items;
    cb(Array.isArray(items) ? items : []);
  }, onError);

const changeNotes = (uid, change) => runTransaction(db, async transaction => {
  const ref = priorityRef(uid);
  const snapshot = await transaction.get(ref);
  const current = snapshot.data()?.items;
  const items = change(Array.isArray(current) ? current : []);
  transaction.set(ref, { uid, items, updatedAt: serverTimestamp() });
});

export const addPriorityNote = (uid, text) => {
  const id = doc(collection(db, 'priorityNotes')).id;
  return changeNotes(uid, items => [...items, { id, text }]);
};

export const updatePriorityNote = (uid, id, text) =>
  changeNotes(uid, items => items.map(item => item.id === id ? { ...item, text } : item));

export const deletePriorityNote = (uid, id) =>
  changeNotes(uid, items => items.filter(item => item.id !== id));

export const movePriorityNote = (uid, id, direction) =>
  changeNotes(uid, items => {
    const index = items.findIndex(item => item.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= items.length) return items;
    const reordered = [...items];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    return reordered;
  });
