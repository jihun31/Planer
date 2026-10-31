import { addDoc, collection, deleteDoc, deleteField, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { checkInDoc, goalCompleteUpdate, goalUndoUpdate, planDeleteUpdate, planDoc, planEditUpdate, restDoc } from './tonkatsuWrites.mjs';

const docs = (snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }));

/** 내 데이터만 실시간 구독. onData(name, docs), onError(error). 해제 함수를 돌려줌 */
export function subscribeTonkatsu(myDiscordId, onData, onError) {
  const mine = (name) => query(collection(db, name), where('ownerId', '==', myDiscordId));
  const sources = {
    plans: mine('plans'),
    checkIns: mine('checkIns'),
    offDays: mine('offDays'),
    myFines: query(collection(db, 'fineEvents'), where('discordId', '==', myDiscordId)),
  };
  const stops = Object.entries(sources).map(([name, ref]) => onSnapshot(ref, (snap) => onData(name, docs(snap)), onError));
  stops.push(onSnapshot(doc(db, 'members', myDiscordId),
    (snap) => onData('members', snap.exists() ? [{ ...snap.data(), id: snap.id }] : []), onError));
  return () => stops.forEach((stop) => stop());
}

export function addPlan(ownerId, input, startDate) {
  return addDoc(collection(db, 'plans'), planDoc(ownerId, input, startDate, serverTimestamp()));
}

export function editPlan(plan, changes) {
  return updateDoc(doc(db, 'plans', plan.id), planEditUpdate(plan, changes, serverTimestamp()));
}

export function deletePlan(planId) {
  return updateDoc(doc(db, 'plans', planId), planDeleteUpdate(serverTimestamp()));
}

/** 인증. 목표 계획은 같은 요청에서 달성 처리 */
export async function checkIn(plan, ownerId, date) {
  const { id, data } = checkInDoc(plan, ownerId, date, serverTimestamp());
  if (!id) return addDoc(collection(db, 'checkIns'), data);
  if (plan.category !== 'OneTime') return setDoc(doc(db, 'checkIns', id), data);
  const batch = writeBatch(db);
  batch.set(doc(db, 'checkIns', id), data);
  batch.update(doc(db, 'plans', plan.id), goalCompleteUpdate(date, serverTimestamp()));
  return batch.commit();
}

/** 인증 한 번 취소 (checkInId: 지울 기록). 그날 달성한 목표면 다시 진행 중으로 */
export function cancelCheckIn(plan, checkInId) {
  if (!plan.completed) return deleteDoc(doc(db, 'checkIns', checkInId));
  const batch = writeBatch(db);
  batch.delete(doc(db, 'checkIns', checkInId));
  batch.update(doc(db, 'plans', plan.id), goalUndoUpdate(serverTimestamp(), deleteField()));
  return batch.commit();
}

export function takeRest(ownerId, date) {
  const { id, data } = restDoc(ownerId, date, serverTimestamp());
  return setDoc(doc(db, 'offDays', id), data);
}
export function cancelRest(offDayId) {
  return deleteDoc(doc(db, 'offDays', offDayId));
}

export function setAlertHour(discordId, hour) {
  return updateDoc(doc(db, 'members', discordId), { alertHour: hour });
}
