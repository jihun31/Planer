import { useCallback, useEffect, useMemo, useState } from "react";
import {
  subscribeActivities, subscribeAllBlocks,
  addActivity, deleteActivity, addBlock, deleteBlock, updateActivityOrder, saveTimer,
} from "./plannerService";
import { monthDates, selectedDateOutsideMonth } from "./blockSubscriptions.mjs";
import { subscribeControlActivities } from './controlService';
import { colorizeControlBlocks } from './controlColors.mjs';
import { excludeStudyTime } from './controlTime.mjs';
import { isControlBlock, isStudyBlock } from './blockKind.mjs';

function useLiveData(uid, scope, subscribe, retry) {
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    if (!uid) return;
    let active = true;
    let unsubscribe;
    // StrictMode's discarded setup must not open a second server listener.
    queueMicrotask(() => {
      if (!active) return;
      const onError = error => {
        if (active) setSnapshot({ uid, scope, data: [], error });
      };
      try {
        unsubscribe = subscribe(uid, data => {
          if (active) setSnapshot({ uid, scope, data, error: null });
        }, onError);
      } catch (error) {
        onError(error);
      }
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [uid, scope, subscribe, retry]);
  if (!uid) return { data: [], loading: false, error: null };
  if (snapshot?.uid !== uid || snapshot?.scope !== scope) {
    return { data: [], loading: true, error: null };
  }
  return { data: snapshot.data, loading: false, error: snapshot.error };
}

export const usePlanner = (uid, year, month, selectedDate) => {
  const [retry, setRetry] = useState(0);
  const monthKey = `${year}-${month}`;
  const extraDate = selectedDateOutsideMonth(year, month, selectedDate);
  const subscribeMonth = useCallback(
    (userId, cb, onError) => subscribeAllBlocks(userId, monthDates(year, month), cb, onError),
    [year, month],
  );
  const subscribeSelectedDay = useCallback((userId, cb, onError) => {
    if (!extraDate) { cb([]); return () => {}; }
    return subscribeAllBlocks(userId, [extraDate], cb, onError);
  }, [extraDate]);
  const activityState = useLiveData(uid, 'activities', subscribeActivities, retry);
  const monthState = useLiveData(uid, monthKey, subscribeMonth, retry);
  const dayState = useLiveData(uid, extraDate, subscribeSelectedDay, retry);
  const controlActivityState = useLiveData(uid, 'control-activities', subscribeControlActivities, retry);
  const allBlocks = useMemo(() => [...monthState.data, ...dayState.data], [monthState.data, dayState.data]);
  const blocks = useMemo(() => allBlocks.filter(isStudyBlock), [allBlocks]);
  const rawControlBlocks = useMemo(() => allBlocks.filter(isControlBlock), [allBlocks]);
  const oppositeBlocks = useMemo(() => colorizeControlBlocks(
    excludeStudyTime(rawControlBlocks, blocks), controlActivityState.data),
  [rawControlBlocks, blocks, controlActivityState.data]);
  return {
    activities: activityState.data.filter(activity => !activity.archived),
    allActivities: activityState.data,
    blocks, oppositeBlocks,
    oppositeActivities: controlActivityState.data,
    loading: [activityState, monthState, dayState, controlActivityState].some(s => s.loading),
    error: [activityState, monthState, dayState, controlActivityState].find(s => s.error)?.error || null,
    retryLoading: () => setRetry(value => value + 1),
    addActivity: (data) => addActivity(uid, data),
    deleteActivity: (activityId) => deleteActivity(uid, activityId),
    addBlock: (data) => {
      const activity = activityState.data.find(item => item.id === data.activityId);
      return addBlock(uid, activity ? {
        ...data, activityName: activity.name, activityColor: activity.color,
      } : data);
    },
    saveTimer: data => saveTimer(uid, data),
    deleteBlock,
    updateActivityOrder: (ids) => updateActivityOrder(ids),
  };
};
