import { useEffect, useState } from "react";
import { useCollection } from "../../lib/useCollection";
import { dayKey } from "./habitCore.mjs";
import { subscribeHabits, addHabit, updateHabit, setArchived, setHabitLog, deleteHabit, setAutomaticity } from "./habitService";

// 앱을 켜 둔 채 새벽 5시를 넘기면 '오늘'이 바뀌도록 1분마다 확인한다.
export function useDayKey() {
  const [day, setDay] = useState(dayKey);
  useEffect(() => {
    const timer = setInterval(() => setDay(current => (current === dayKey() ? current : dayKey())), 60_000);
    return () => clearInterval(timer);
  }, []);
  return day;
}

export const useHabits = (uid) => {
  const [habits, ready, error] = useCollection(uid, subscribeHabits);
  const today = useDayKey();
  return {
    habits, today, loading: !ready, error,
    addHabit: (value) => addHabit(uid, value),
    updateHabit,
    archiveHabit: (habitId) => setArchived(habitId, true),
    restoreHabit: (habitId) => setArchived(habitId, false),
    deleteHabit: (habitId) => deleteHabit(uid, habitId),
    setLog: setHabitLog,
    setAutomaticity,
  };
};
