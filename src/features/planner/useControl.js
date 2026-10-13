import { useCallback, useEffect, useMemo, useState } from 'react';
import { monthDates, selectedDateOutsideMonth } from './blockSubscriptions.mjs';
import { subscribeActivities as subscribeStudyActivities, subscribeAllBlocks } from './plannerService';
import { isControlBlock, isStudyBlock } from './blockKind.mjs';
import { excludeStudyTime, overlapsStudy } from './controlTime.mjs';
import { controlColor, colorizeControlBlocks, orderControlActivities } from './controlColors.mjs';
import {
  subscribeControlActivities, addControlActivity,
  archiveControlActivity, changeControlActivityGroup, updateControlActivityOrder,
  addControlBlock, deleteControlBlock, saveControlTimer,
  readStudyBlocks,
} from './controlService';

function useLiveData(uid, scope, subscribe, retry) {
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    if (!uid) return;
    let active = true;
    let unsubscribe;
    queueMicrotask(() => {
      if (!active) return;
      try {
        unsubscribe = subscribe(uid,
          data => { if (active) setSnapshot({ uid, scope, data, error: null }); },
          error => { if (active) setSnapshot({ uid, scope, data: [], error }); });
      } catch (error) {
        if (active) setSnapshot({ uid, scope, data: [], error });
      }
    });
    return () => { active = false; unsubscribe?.(); };
  }, [uid, scope, subscribe, retry]);
  if (!uid) return { data: [], loading: false, error: null };
  if (snapshot?.uid !== uid || snapshot?.scope !== scope) return { data: [], loading: true, error: null };
  return { data: snapshot.data, loading: false, error: snapshot.error };
}

export function useControl(uid, year, month, selectedDate) {
  const [retry, setRetry] = useState(0);
  const monthKey = `${year}-${month}`;
  const extraDate = selectedDateOutsideMonth(year, month, selectedDate);
  const subscribeMonth = useCallback((id, cb, err) => subscribeAllBlocks(id, monthDates(year, month), cb, err), [year, month]);
  const subscribeDay = useCallback((id, cb, err) => extraDate ? subscribeAllBlocks(id, [extraDate], cb, err) : (cb([]), () => {}), [extraDate]);
  const activityState = useLiveData(uid, 'control-activities', subscribeControlActivities, retry);
  const studyActivityState = useLiveData(uid, 'study-activities', subscribeStudyActivities, retry);
  const monthState = useLiveData(uid, monthKey, subscribeMonth, retry);
  const dayState = useLiveData(uid, extraDate, subscribeDay, retry);
  const allBlocks = useMemo(() => [...monthState.data, ...dayState.data], [monthState.data, dayState.data]);
  const studyBlocks = useMemo(() => allBlocks.filter(isStudyBlock), [allBlocks]);
  const rawBlocks = useMemo(() => allBlocks.filter(isControlBlock), [allBlocks]);
  const blocks = useMemo(() => colorizeControlBlocks(excludeStudyTime(rawBlocks, studyBlocks), activityState.data),
    [rawBlocks, studyBlocks, activityState.data]);
  const allActivities = orderControlActivities(activityState.data.map(a => ({ ...a, color: controlColor(a.group) })));
  return {
    activities: allActivities.filter(a => !a.archived),
    allActivities,
    blocks, oppositeBlocks: studyBlocks, oppositeActivities: studyActivityState.data,
    loading: [activityState, studyActivityState, monthState, dayState].some(s => s.loading),
    error: [activityState, studyActivityState, monthState, dayState].find(s => s.error)?.error || null,
    retryLoading: () => setRetry(v => v + 1),
    addActivity: data => addControlActivity(uid, { ...data, color: controlColor(data.group) }),
    deleteActivity: archiveControlActivity,
    updateActivityGroup: changeControlActivityGroup,
    updateActivityOrder: updateControlActivityOrder,
    addBlock: async data => {
      const currentStudy = await readStudyBlocks(uid, [data.date]);
      if (overlapsStudy(data, currentStudy)) throw new Error('study-overlap');
      const activity = activityState.data.find(a => a.id === data.activityId);
      return addControlBlock(uid, activity ? {
        ...data, activityName: activity.name, activityColor: controlColor(activity.group), group: activity.group,
      } : data);
    },
    saveTimer: async data => {
      const currentStudy = await readStudyBlocks(uid, data.segments.map(segment => segment.date));
      return saveControlTimer(uid, {
        ...data,
        segments: excludeStudyTime(data.segments, currentStudy),
      });
    },
    deleteBlock: deleteControlBlock,
  };
}
