import { useCollection } from "../../lib/useCollection";
import {
  subscribeHabits, subscribeHabitLogs,
  addHabit, deleteHabit, checkHabit, uncheckHabit,
} from "./habitService";

export const useHabits = (uid) => {
  const [habits,    hr] = useCollection(uid, subscribeHabits);
  const [habitLogs, lr] = useCollection(uid, subscribeHabitLogs);
  return {
    habits, habitLogs,
    loading: !hr || !lr,
    addHabit:     (data) => addHabit(uid, data),
    deleteHabit: (habitId) => deleteHabit(uid, habitId),
    checkHabit:   (habitId) => checkHabit(uid, habitId),
    uncheckHabit: (habitId) => uncheckHabit(habitId, habitLogs),
  };
};
