import { excludeStudyTime, overlapsStudy } from './controlTime.mjs';
import { controlColor, orderControlActivities } from './controlColors.mjs';
import {
  addControlActivity,
  archiveControlActivity, changeControlActivityGroup, updateControlActivityOrder,
  addControlBlock, deleteControlBlock, saveControlTimer,
  readStudyBlocks,
} from './controlService';
import { usePlannerRecords } from './usePlannerRecords';

export function useControl(uid, year, month, selectedDate) {
  const records = usePlannerRecords(uid, year, month, selectedDate);
  const controlActivities = records.controlActivities;
  const allActivities = orderControlActivities(controlActivities.map(a => ({ ...a, color: controlColor(a.group) })));
  return {
    activities: allActivities.filter(a => !a.archived),
    allActivities,
    blocks: records.controlBlocks,
    oppositeBlocks: records.studyBlocks,
    oppositeActivities: records.studyActivities,
    loading: records.loading,
    error: records.error,
    retryLoading: records.retryLoading,
    addActivity: data => addControlActivity(uid, { ...data, color: controlColor(data.group) }),
    deleteActivity: archiveControlActivity,
    updateActivityGroup: changeControlActivityGroup,
    updateActivityOrder: updateControlActivityOrder,
    addBlock: async data => {
      const currentStudy = await readStudyBlocks(uid, [data.date]);
      if (overlapsStudy(data, currentStudy)) throw new Error('study-overlap');
      const activity = controlActivities.find(a => a.id === data.activityId);
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
