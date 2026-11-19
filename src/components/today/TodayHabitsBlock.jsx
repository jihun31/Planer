import { countLabel, countOf, dueToday, isCountHabit, statusOf } from '../../features/habits/habitCore.mjs';
import { useHabitCheck } from '../habits/useHabitCheck';
import { StreakBadge, TodayActions } from '../habits/HabitCard';
import { BadgeToast } from '../habits/HabitBadges';
import '../../styles/habits.css';

const MARK = { full: '✓', tiny: '◐', skip: '💤' };

// 오늘 탭의 '오늘의 습관'. 매일 여는 화면에서 클릭 한 번으로 기록한다(Wood: 마찰 줄이기).
export default function TodayHabitsBlock({ habitsData, onOpen }) {
  const { habits, today, loading, setLog } = habitsData;
  const check = useHabitCheck(setLog);
  const list = dueToday(habits, today);
  const hasHabits = habits.some(h => !h.archived);
  if (loading) return null;
  if (!hasHabits && !onOpen) return null;

  // 동그라미: 일반 습관은 완료/취소, 횟수 습관은 +1, 쉬는 날이면 쉬기 취소
  const press = habit => {
    const status = statusOf(habit, today);
    if (status === 'skip') return check.save(habit, today, null);
    if (isCountHabit(habit)) return check.step(habit, today, 1);
    return check.save(habit, today, status ? null : 'full');
  };
  const label = habit => {
    const status = statusOf(habit, today);
    if (status === 'skip') return `${habit.name} 쉬기 취소`;
    if (isCountHabit(habit)) return `${habit.name} 1 더하기`;
    return status ? `${habit.name} 기록 취소` : `${habit.name} 완료`;
  };

  return <section className="today-block habit-today-block" aria-label="오늘의 습관">
    <div className="today-block-hdr">
      <span className="today-block-title">🔁 오늘의 습관</span>
      {onOpen && <button type="button" className="block-manage-btn" onClick={onOpen}>관리</button>}
    </div>
    {!hasHabits ? <p className="today-block-empty">작은 습관 하나로 시작해 보세요.</p>
      : list.length === 0 ? <p className="today-block-empty">오늘은 할 습관이 없어요.</p>
      : <ul className="habit-today-list">
        {list.map(habit => {
          const status = statusOf(habit, today);
          const counting = isCountHabit(habit) && status !== 'skip';
          return <li key={habit.id} className={`habit-today-item ${status ?? ''} ${check.isCelebrating(habit, today) ? 'celebrate' : ''}`}>
            <button type="button" className={`habit-check ${status ?? ''} ${counting ? 'count' : ''}`} disabled={check.isPending(habit, today)}
              aria-label={label(habit)} aria-pressed={Boolean(status)} onClick={() => press(habit)}>
              {counting ? (countOf(habit, today) || '+') : MARK[status] ?? ''}
            </button>
            <span className="habit-today-text">
              <span className="habit-today-name">{habit.emoji} {habit.name}
                {counting && <span className="habit-today-count"> {countLabel(habit, countOf(habit, today))}</span>}
                {status === 'skip' && <span className="habit-today-count"> 쉬는 날</span>}</span>
              {habit.anchor && <span className="habit-today-anchor">{habit.anchor}</span>}
            </span>
            <StreakBadge habit={habit} today={today} />
            <TodayActions habit={habit} today={today} check={check} compact />
            {check.isCelebrating(habit, today) && <span className="habit-confetti" aria-hidden="true">🎉</span>}
          </li>;
        })}
      </ul>}
    {list.map(habit => <BadgeToast key={habit.id} habit={habit} milestone={check.badgeFor(habit)} />)}
    {check.failure && <p role="alert" className="habit-error">{check.failure}</p>}
  </section>;
}
