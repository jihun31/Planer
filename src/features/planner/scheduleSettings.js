import { collection, query, where, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { plannerDate, validRange } from './scheduleTime.mjs';
import { validDisplayMode } from './oppositeDisplay.mjs';
export const subscribeScheduleSettings = (uid, cb, onError) => onSnapshot(
  query(collection(db, 'plannerSettings'), where('uid', '==', uid)),
  snapshot => cb(snapshot.docs.map(d => ({ ...d.data(), id: d.id }))), onError,
);
export function saveScheduleSettings(uid, settings) {
  if (!uid || !validRange(settings)
    || !validDisplayMode(settings.plannerOppositeDisplay)
    || !validDisplayMode(settings.controlOppositeDisplay)) throw new Error('Invalid settings');
  return addDoc(collection(db, 'plannerSettings'), {
    uid, startHour: settings.startHour, endHour: settings.endHour,
    plannerOppositeDisplay: settings.plannerOppositeDisplay,
    controlOppositeDisplay: settings.controlOppositeDisplay,
    effectiveDate: plannerDate(), changedAt: Date.now(), createdAt: serverTimestamp(),
  });
}
