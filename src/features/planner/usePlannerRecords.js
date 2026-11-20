import { useCallback, useMemo, useState } from 'react';
import { useLiveData } from '../../lib/useCollection';
import { subscribeActivities, subscribeAllBlocks } from './plannerService';
import { subscribeControlActivities } from './controlService';
import { monthDates, selectedDateOutsideMonth } from './blockSubscriptions.mjs';
import { colorizeControlBlocks } from './controlColors.mjs';
import { excludeStudyTime } from './controlTime.mjs';
import { isControlBlock, isStudyBlock } from './blockKind.mjs';

// The record (study) and control screens read the same data: both activity lists and
// the month's blocks, plus the selected day when it lies in another month.
// Each screen shows one side as its own and the other as the opposite layer.
export function usePlannerRecords(uid, year, month, selectedDate) {
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
  const studyActivityState = useLiveData(uid, 'study-activities', subscribeActivities, retry);
  const monthState = useLiveData(uid, monthKey, subscribeMonth, retry);
  const dayState = useLiveData(uid, extraDate, subscribeSelectedDay, retry);
  const controlActivityState = useLiveData(uid, 'control-activities', subscribeControlActivities, retry);
  const allBlocks = useMemo(() => [...monthState.data, ...dayState.data], [monthState.data, dayState.data]);
  const studyBlocks = useMemo(() => allBlocks.filter(isStudyBlock), [allBlocks]);
  const rawControlBlocks = useMemo(() => allBlocks.filter(isControlBlock), [allBlocks]);
  // Study time wins where both overlap, so control blocks are trimmed around it.
  const controlBlocks = useMemo(() => colorizeControlBlocks(
    excludeStudyTime(rawControlBlocks, studyBlocks), controlActivityState.data),
  [rawControlBlocks, studyBlocks, controlActivityState.data]);
  const states = [studyActivityState, monthState, dayState, controlActivityState];
  return {
    studyActivities: studyActivityState.data,
    controlActivities: controlActivityState.data,
    studyBlocks, controlBlocks,
    loading: states.some(s => s.loading),
    error: states.find(s => s.error)?.error || null,
    retryLoading: () => setRetry(value => value + 1),
  };
}
