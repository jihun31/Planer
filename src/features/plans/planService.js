import { collection, doc, onSnapshot, query, where, runTransaction, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { entryInput, overrideId, planToday, routineInput } from './planModel.mjs';

const ownerRef=uid=>doc(db,'dayPlans',uid);
const routinesRef=uid=>collection(db,'dayPlans',uid,'routines');
const entriesRef=uid=>collection(db,'dayPlans',uid,'entries');
const requireOwner=uid=>{if (!uid) throw new Error('로그인이 필요합니다.');};
const requireId=id=>{if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error('계획을 확인해 주세요.');};

export const subscribeRoutines=(uid,next,error)=>onSnapshot(routinesRef(uid),snapshot=>
  next(snapshot.docs.map(item=>({...item.data(),id:item.id}))),error);
export const subscribePlanEntries=(uid,dates,next,error)=>onSnapshot(query(entriesRef(uid),where('date','in',dates)),snapshot=>
  next(snapshot.docs.map(item=>({...item.data(),id:item.id}))),error);

// A monotonically increasing revision orders simultaneous edits. Historical
// versions remain intact; only versions effective on that date can apply.
export async function saveRoutine(uid,data,{routineId=null,clearEntryId=null}={}) {
  requireOwner(uid);
  const input=routineInput(data);
  if (input.effectiveDate<planToday()) input.effectiveDate=planToday();
  const key=routineId || doc(routinesRef(uid)).id;requireId(key);
  if (clearEntryId) requireId(clearEntryId);
  const versionRef=doc(routinesRef(uid)),counterRef=ownerRef(uid);
  await runTransaction(db,async transaction=>{
    const counter=await transaction.get(counterRef);
    const clearRef=clearEntryId ? doc(entriesRef(uid),clearEntryId) : null;
    const previous=clearRef ? await transaction.get(clearRef) : null;
    if (previous?.exists() && previous.data().routineId && previous.data().routineId !== key)
      throw new Error('다른 반복 루틴의 계획은 변경할 수 없습니다.');
    const revision=(counter.data()?.revision || 0)+1;
    transaction.set(counterRef,{uid,revision,updatedAt:serverTimestamp()});
    transaction.set(versionRef,{...input,uid,routineId:key,revision,createdAt:serverTimestamp()});
    if (previous?.exists() && previous.data().date>=input.effectiveDate) transaction.delete(clearRef);
  });
  return key;
}
export async function savePlanEntry(uid,data,id=null) {
  requireOwner(uid);const input=entryInput(data);
  const key=input.routineId ? overrideId(input.date,input.routineId) : id;
  if (key) requireId(key);
  const ref=key ? doc(entriesRef(uid),key) : doc(entriesRef(uid));
  await runTransaction(db,async transaction=>{
    const previous=await transaction.get(ref),stored=previous.data();
    if (previous.exists() && (stored.date !== input.date || stored.routineId !== input.routineId))
      throw new Error('계획의 날짜를 확인해 주세요.');
    transaction.set(ref,{...input,uid,createdAt:stored?.createdAt ?? serverTimestamp(),updatedAt:serverTimestamp()});
  });
  return ref.id;
}
export function removePlanEntry(uid,id) {requireOwner(uid);requireId(id);return deleteDoc(doc(entriesRef(uid),id));}
