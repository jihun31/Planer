import { useCollection } from "../../lib/useCollection";
import {
  subscribeProgressItems, subscribeProgressLogs,
  addProgressItem, deleteProgressItem,
  addProgressLog, deleteProgressLog,
} from "./progressService";

export const useProgress = (uid) => {
  const [items, ir] = useCollection(uid, subscribeProgressItems);
  const [logs,  lr] = useCollection(uid, subscribeProgressLogs);
  return {
    items, logs,
    loading: !ir || !lr,
    addItem:    (data) => addProgressItem(uid, data),
    deleteItem: (itemId) => deleteProgressItem(uid, itemId),
    addLog:     (progressItemId, goalId, note, date) => addProgressLog(uid, progressItemId, goalId, note, date),
    deleteLog:  deleteProgressLog,
  };
};
