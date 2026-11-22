import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useCollection } from '../../lib/useCollection';
import { learningStats, dateShift, goalEffectiveDate, recentDates, streakReachesDate, SUMMARY_DAYS, validActivityTargets, validGoal, withRecentGoal } from './learningStats.mjs';
import { plannerDate } from '../planner/scheduleTime.mjs';
import { subscribeActivities, subscribeAllBlocks } from '../planner/plannerService';
import { isStudyBlock } from '../planner/blockKind.mjs';
import { archivedActivityReferences, missingActivitySnapshot } from './archivedActivity.mjs';

const subscribe = name => (uid, callback, onError) => onSnapshot(
  query(collection(db,name),where('uid','==',uid)),
  snapshot => callback(snapshot.docs.map(doc => ({...doc.data(), id:doc.id}))), onError);
// The planner summary shows only today and the current streak, so it reads recent days.
// The learning tab needs the whole history (badges, records) and loads it once opened.
// Fresh functions on retry make every listener reconnect.
const subscriptions = () => ({
  allBlocks: subscribe('scheduleBlocks'),
  recentBlocks: (...args) => subscribeAllBlocks(...args),
  goals: subscribe('learningGoals'),
  activities: (...args) => subscribeActivities(...args),
});
const NO_ACTIVITIES = Object.freeze([]);
export function useLearning(uid, { full = false } = {}) {
  const [listeners,setListeners] = useState(subscriptions);
  const [now,setNow] = useState(() => new Date());
  const today = plannerDate(now);
  const [range,setRange] = useState({ today, days: SUMMARY_DAYS });
  const summaryDays = range.today === today ? range.days : SUMMARY_DAYS;
  const listenBlocks = useMemo(() => {
    if (full) return listeners.allBlocks;
    const dates = recentDates(today,summaryDays);
    return (id,callback,onError) => listeners.recentBlocks(id,dates,callback,onError);
  },[full,listeners,today,summaryDays]);
  const [blocks, blocksReady, blocksError] = useCollection(uid,listenBlocks);
  const [savedHistory, goalsReady, goalsError] = useCollection(uid,listeners.goals);
  const [recentGoal,setRecentGoal] = useState(null);
  // Creation times decide whether an activity added after the last selection counts.
  const [loadedActivities, activitiesReady, activitiesError] = useCollection(uid,listeners.activities);
  const activities = activitiesReady ? loadedActivities : NO_ACTIVITIES;
  useEffect(() => {
    if (!uid) return;
    const refresh = () => setNow(new Date());
    const timer = setInterval(refresh,30000);
    window.addEventListener('focus',refresh);
    refresh();
    return () => { clearInterval(timer); window.removeEventListener('focus',refresh); };
  },[uid]);
  // A successful write can resolve before the goals listener has delivered its
  // next snapshot. Keep that goal visible when the editor is opened again.
  const history = useMemo(() => withRecentGoal(savedHistory,recentGoal,uid),[savedHistory,recentGoal,uid]);
  const stats = useMemo(() => learningStats(blocks,history,now,activities),[blocks,history,now,activities]);
  // Read further back before showing a streak that may continue past the loaded days.
  const streakCut = !full && blocksReady && !blocksError
    && streakReachesDate(stats,dateShift(today,1-summaryDays));
  useEffect(() => {
    if (streakCut) setRange({ today, days: summaryDays*2 });
  },[streakCut,today,summaryDays]);
  const saveGoal = async (minutes, includedActivityIds, activityTargets) => {
    if (!uid || !full || !goalsReady || goalsError || !validGoal(minutes)
      || !validActivityTargets(includedActivityIds,activityTargets)
      || includedActivityIds.some(id => !activities.some(activity => activity.id === id)))
      throw new Error('학습 목표와 활동 선택을 확인해 주세요.');
    const goal = {
      uid, minutes, includedActivityIds, activityTargets,
      effectiveDate: goalEffectiveDate(history,plannerDate()),
      changedAt: Date.now(), createdAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db,'learningGoals'), goal);
    const saved = { ...goal, id: ref.id };
    setRecentGoal(saved);
    return saved;
  };
  const setCustomLearning = async (blockId, included) => {
    const block = blocks.find(item => item.id === blockId);
    if (!uid || !block || !isStudyBlock(block) || block.activityId || typeof included !== 'boolean')
      throw new Error('직접 입력 기록을 확인해 주세요.');
    await updateDoc(doc(db,'scheduleBlocks',blockId), { learningIncluded: included });
  };
  const permanentlyDeleteArchivedActivity = async activityId => {
    // Every past record must be loaded so none keeps a reference to the deleted activity.
    if (!uid || !full || !blocksReady || blocksError || !activitiesReady || activitiesError)
      throw new Error('기록을 먼저 불러와 주세요.');
    const activity = activities.find(item => item.id === activityId && item.archived);
    if (!activity) throw new Error('보관된 활동을 찾지 못했습니다.');
    const references = archivedActivityReferences(blocks,activityId);
    const updates = references.map(block => ({ id:block.id, patch:missingActivitySnapshot(block,activity) }))
      .filter(item => Object.keys(item.patch).length);
    for (let offset=0; offset<updates.length; offset+=400) {
      const batch = writeBatch(db);
      for (const item of updates.slice(offset,offset+400))
        batch.update(doc(db,'scheduleBlocks',item.id),item.patch);
      await batch.commit();
    }
    await deleteDoc(doc(db,'plannerActivities',activityId));
    return references.length;
  };
  return { stats, history, blocks, activities, ready: blocksReady && goalsReady && activitiesReady && !streakCut,
    error: blocksError || goalsError || activitiesError, saveGoal, setCustomLearning,
    permanentlyDeleteArchivedActivity,
    retry: () => setListeners(subscriptions()) };
}
