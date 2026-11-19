import { useEffect, useRef, useState } from 'react';
import { nextCellValue, statusOf, stepCount } from '../../features/habits/habitCore.mjs';

// 습관 칸 체크: 저장 중 표시, 실패 안내, 완료 직후 짧은 축하 효과(Fogg의 Celebration)를 맡는다.
export function useHabitCheck(setLog) {
  const [pending, setPending] = useState(null);
  const [failure, setFailure] = useState('');
  const [celebrating, setCelebrating] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const save = async (habit, day, value) => {
    const key = `${habit.id}:${day}`;
    if (pending === key) return;
    const before = statusOf(habit, day);
    const after = statusOf({ ...habit, logs: { ...habit.logs, [day]: value ?? undefined } }, day);
    setPending(key);
    setFailure('');
    try {
      await setLog(habit.id, day, value);
      // 새로 완료(또는 목표 달성)했을 때만 축하한다
      if (after === 'full' ? before !== 'full' : after === 'tiny' && !before) {
        clearTimeout(timer.current);
        setCelebrating(key);
        timer.current = setTimeout(() => setCelebrating(null), 900);
      }
    } catch { setFailure('기록을 저장하지 못했어요. 연결 상태를 확인해 주세요.'); }
    finally { setPending(current => (current === key ? null : current)); }
  };

  return {
    save, failure,
    cycle: (habit, day) => save(habit, day, nextCellValue(habit, day)),
    step: (habit, day, delta) => save(habit, day, stepCount(habit, day, delta)),
    isPending: (habit, day) => pending === `${habit.id}:${day}`,
    isCelebrating: (habit, day) => celebrating === `${habit.id}:${day}`,
  };
}
