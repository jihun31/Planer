import {
  collection, doc, query, where, onSnapshot, serverTimestamp,
  writeBatch, updateDoc, deleteDoc,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { subscribeDateGroups } from '../planner/blockSubscriptions.mjs';
import { eventInput } from './calendarDates.mjs';

export const subscribeCalendarEvents = (uid, dates, onData, onError) =>
  subscribeDateGroups(dates, (group, receive, fail) => onSnapshot(
    query(collection(db, 'calendarEvents'), where('uid', '==', uid), where('date', 'in', group)),
    snapshot => receive(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
    fail,
  ), onData, onError);

// One commit prevents a calendar event from being saved without its requested task.
// After registration, tasks and events are intentionally managed independently.
export async function addCalendarEvent(uid, data, addToTasks = false) {
  if (!uid) throw new Error('로그인이 필요합니다.');
  const input = eventInput(data);
  const eventRef = doc(collection(db, 'calendarEvents'));
  const taskRef = addToTasks ? doc(collection(db, 'todos')) : null;
  const batch = writeBatch(db);
  batch.set(eventRef, {
    ...input, uid, taskId: taskRef?.id ?? null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  if (taskRef) batch.set(taskRef, {
    uid, title: input.title, dueDate: input.date, completed: false,
    calendarEventId: eventRef.id, createdAt: serverTimestamp(),
  });
  await batch.commit();
  return eventRef.id;
}

export function updateCalendarEvent(id, data) {
  return updateDoc(doc(db, 'calendarEvents', id), { ...eventInput(data), updatedAt: serverTimestamp() });
}

export const deleteCalendarEvent = id => deleteDoc(doc(db, 'calendarEvents', id));
