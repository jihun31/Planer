import { useCollection } from "../../lib/useCollection";
import { subscribeTasks, addTask, deleteTask, toggleTask } from "./taskService";

export const useTasks = (uid) => {
  const [tasks, ready, error] = useCollection(uid, subscribeTasks);
  return {
    error: error,
    tasks,
    loading: !ready,
    addTask: (data) => addTask(uid, data),
    deleteTask,
    toggleTask,
  };
};
