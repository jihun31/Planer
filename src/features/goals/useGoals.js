import { useCollection } from "../../lib/useCollection";
import {
  subscribeGoals, subscribeSubGoals,
  addGoal, deleteGoal, addSubGoal, deleteSubGoal, toggleSubGoal,
  updateGoalColor, updateGoalTitle,
} from "./goalService";

export const useGoals = (uid) => {
  const [goals,    gr, ge] = useCollection(uid, subscribeGoals);
  const [subGoals, sr, se] = useCollection(uid, subscribeSubGoals);
  return {
    error: ge || se,
    goals, subGoals,
    loading: !gr || !sr,
    addGoal:         (title, color) => addGoal(uid, title, color),
    deleteGoal: (goalId) => deleteGoal(uid, goalId),
    updateGoalColor,
    updateGoalTitle,
    addSubGoal:      (goalId, data) => addSubGoal(uid, goalId, data),
    deleteSubGoal,
    toggleSubGoal,
  };
};
