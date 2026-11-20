import {
  addActivity, deleteActivity, addBlock, deleteBlock, updateActivityOrder, updateActivityColor, saveTimer,
} from "./plannerService";
import { usePlannerRecords } from './usePlannerRecords';

export const usePlanner = (uid, year, month, selectedDate) => {
  const records = usePlannerRecords(uid, year, month, selectedDate);
  const allActivities = records.studyActivities;
  return {
    activities: allActivities.filter(activity => !activity.archived),
    allActivities,
    blocks: records.studyBlocks,
    oppositeBlocks: records.controlBlocks,
    oppositeActivities: records.controlActivities,
    loading: records.loading,
    error: records.error,
    retryLoading: records.retryLoading,
    addActivity: (data) => addActivity(uid, data),
    deleteActivity: (activityId) => deleteActivity(uid, activityId),
    addBlock: (data) => {
      const activity = allActivities.find(item => item.id === data.activityId);
      return addBlock(uid, activity ? {
        ...data, activityName: activity.name, activityColor: activity.color,
      } : data);
    },
    saveTimer: data => saveTimer(uid, data),
    deleteBlock,
    updateActivityOrder: (ids) => updateActivityOrder(ids),
    updateActivityColor: (activity, color) => updateActivityColor(activity, color),
  };
};
