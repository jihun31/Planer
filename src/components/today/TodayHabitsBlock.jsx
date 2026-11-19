import { dueToday, logOf } from '../../features/habits/habitCore.mjs';
import { useHabitCheck } from '../habits/useHabitCheck';
import { StreakBadge } from '../habits/HabitCard';
import '../../styles/habits.css';

// 오늘 탭의 '오늘의 습관'. 매일 여는 화면에서 클릭 한 번으로 기록한다(Wood: 마찰 줄이기).
export default function TodayHabitsBlock({ habitsData, onOpen }) {
  const { habits, today, loading, setLog } = habitsData;
  const check = useHabitCheck(setLog);
  const list = dueToday(habits, today);
  const hasHabits = habits.some(h => !h.archived);
  if (loading) return null;
  if (!hasHabits && !onOpen) return null;

  return <section className="today-block habit-today-block" aria-label="오늘의 습관">
    <div className="today-block-hdr">
      <span className="today-block-title">🔁 오늘의 습관</span>
      {onOpen && <button type="button" className="block-manage-btn" onClick={onOpen}>관리</button>}
    </div>
    {!hasHabits ? <p className="today-block-empty">작은 습관 하나로 시작해 보세요.</p>
      : list.length === 0 ? <p className="today-block-empty">오늘은 할 습관이 없어요.</p>
      : <ul className="habit-today-list">
        {list.map(habit => {
          const log = logOf(habit, today);
          const busy = check.isPending(habit, today);
          return <li key={habit.id} className={`habit-today-item ${log ? 'done' : ''} ${check.isCelebrating(habit, today) ? 'celebrate' : ''}`}>
            <button type="button" className={`habit-check ${log ?? ''}`} disabled={busy}
              aria-label={log ? `${habit.name} 기록 취소` : `${habit.name} 완료`} aria-pressed={Boolean(log)}
              onClick={() => check.save(habit, today, log ? null : 'full')}>{log === 'tiny' ? '◐' : log ? '✓' : ''}</button>
            <span className="habit-today-text">
              <span className="habit-today-name">{habit.emoji} {habit.name}</span>
              {habit.anchor && <span className="habit-today-anchor">{habit.anchor}</span>}
            </span>
            <StreakBadge habit={habit} today={today} />
            {!log && habit.tinyVersion && <button type="button" className="block-manage-btn" disabled={busy}
              title={habit.tinyVersion} onClick={() => check.save(habit, today, 'tiny')}>최소만</button>}
            {check.isCelebrating(habit, today) && <span className="habit-confetti" aria-hidden="true">🎉</span>}
          </li>;
        })}
      </ul>}
    {check.failure && <p role="alert" className="habit-error">{check.failure}</p>}
  </section>;
}
