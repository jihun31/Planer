import { useEffect, useRef, useState } from 'react';
import { logOf } from '../../features/habits/habitCore.mjs';

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
    setPending(key);
    setFailure('');
    try {
      await setLog(habit.id, day, value);
      if (value) {
        clearTimeout(timer.current);
        setCelebrating(key);
        timer.current = setTimeout(() => setCelebrating(null), 900);
      }
    } catch { setFailure('기록을 저장하지 못했어요. 연결 상태를 확인해 주세요.'); }
    finally { setPending(current => (current === key ? null : current)); }
  };

  // 빈 칸 → 완료 → (최소 버전이 있으면) 최소 → 빈 칸
  const cycle = (habit, day) => {
    const now = logOf(habit, day);
    const next = !now ? 'full' : now === 'full' && habit.tinyVersion ? 'tiny' : null;
    return save(habit, day, next);
  };

  return {
    save, cycle, failure,
    isPending: (habit, day) => pending === `${habit.id}:${day}`,
    isCelebrating: (habit, day) => celebrating === `${habit.id}:${day}`,
  };
}
