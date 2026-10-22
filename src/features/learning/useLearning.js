import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useCollection } from '../../lib/useCollection';
import { learningStats, goalEffectiveDate, validActivityTargets, validGoal, withRecentGoal } from './learningStats.mjs';
import { plannerDate } from '../planner/scheduleTime.mjs';
import { subscribeActivities } from '../planner/plannerService';
import { isStudyBlock } from '../planner/blockKind.mjs';
import { archivedActivityReferences, missingActivitySnapshot } from './archivedActivity.mjs';

const subscribe = name => (uid, callback, onError) => onSnapshot(
  query(collection(db,name),where('uid','==',uid)),
  snapshot => callback(snapshot.docs.map(doc => ({...doc.data(), id:doc.id}))), onError);
// Full owner history is loaded only once a learning surface is opened, so long streaks
// and old weekly achievements are not truncated at the visible calendar month.
const subscriptions = () => ({ blocks: subscribe('scheduleBlocks'), goals: subscribe('learningGoals'), activities: subscribeActivities });
export function useLearning(uid) {
  const [listeners,setListeners] = useState(subscriptions);
  const [blocks, blocksReady, blocksError] = useCollection(uid,listeners.blocks);
  const [savedHistory, goalsReady, goalsError] = useCollection(uid,listeners.goals);
  const [recentGoal,setRecentGoal] = useState(null);
  const [activities, activitiesReady, activitiesError] = useCollection(uid,listeners.activities);
  const [now,setNow] = useState(() => new Date());
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
  const saveGoal = async (minutes, includedActivityIds, activityTargets) => {
    if (!uid || !goalsReady || goalsError || !validGoal(minutes)
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
    if (!uid || !blocksReady || blocksError || !activitiesReady || activitiesError)
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
  return { stats, history, blocks, activities, ready: blocksReady && goalsReady && activitiesReady,
    error: blocksError || goalsError || activitiesError, saveGoal, setCustomLearning,
    permanentlyDeleteArchivedActivity,
    retry: () => setListeners(subscriptions()) };
}
