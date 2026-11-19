import { WEEKDAY_LABELS, logOf, scheduleLabel, streakOf, totalDone, weekCells, weekDoneCount, weekStart, weeklyTarget }
  from '../../features/habits/habitCore.mjs';

const CELL_TEXT = { full: '완료', tiny: '최소만 함', missed: '빠짐', open: '아직 안 함', future: '예정', off: '쉬는 요일', before: '시작 전' };
const CELL_MARK = { full: '●', tiny: '◐', missed: '×', open: '○', future: '·', off: '–', before: '' };

export function StreakBadge({ habit, today }) {
  const { count, unit } = streakOf(habit, today);
  if (!count) return null;
  return <span className="habit-streak" title="해야 하는 날을 한 번 빠져도 이어지고, 두 번 연속 빠지면 끊겨요">🔥 {count}{unit}</span>;
}

export default function HabitCard({ habit, today, check, onEdit, onArchive }) {
  const streak = streakOf(habit, today);
  const notStarted = today < habit.startDate;
  const todayLog = logOf(habit, today);
  const weekly = habit.schedule?.type === 'weekly';
  const target = weekly ? weeklyTarget(habit, weekStart(today)) : 0;
  const doneThisWeek = weekly ? weekDoneCount(habit, today) : 0;

  return <article className={`habit-card ${check.isCelebrating(habit, today) ? 'celebrate' : ''}`}>
    <header className="habit-card-hdr">
      <h3 className="habit-card-title">{habit.emoji && <span className="habit-emoji">{habit.emoji}</span>}{habit.name}</h3>
      <span className="habit-badge">{scheduleLabel(habit.schedule)}</span>
      <StreakBadge habit={habit} today={today} />
      <span className="habit-card-menu">
        <button type="button" className="block-manage-btn" onClick={onEdit}>수정</button>
        <button type="button" className="block-manage-btn" onClick={onArchive} title="기록은 남기고 목록에서 뺍니다">보관</button>
      </span>
    </header>

    {habit.anchor && <p className="habit-anchor">⏰ {habit.anchor} → {habit.name}</p>}
    {habit.tinyVersion && <p className="habit-tiny">최소 버전: {habit.tinyVersion}</p>}

    <div className="habit-week" role="group" aria-label={`${habit.name} 이번 주 기록`}>
      {weekCells(habit, today).map(cell => <button key={cell.day} type="button"
        className={`habit-cell ${cell.state} ${cell.day === today ? 'today' : ''}`}
        disabled={!cell.editable || check.isPending(habit, cell.day)}
        title={`${cell.day} · ${CELL_TEXT[cell.state]}${cell.editable ? ' (눌러서 바꾸기)' : ''}`}
        aria-label={`${WEEKDAY_LABELS[cell.weekday]}요일 ${CELL_TEXT[cell.state]}`}
        onClick={() => check.cycle(habit, cell.day)}>
        <span className="habit-cell-day">{WEEKDAY_LABELS[cell.weekday]}</span>
        <span className="habit-cell-mark" aria-hidden="true">{CELL_MARK[cell.state]}</span>
      </button>)}
    </div>

    <footer className="habit-card-foot">
      {notStarted ? <span>{habit.startDate}에 시작해요</span> : <>
        {weekly && <span className={doneThisWeek >= target ? 'habit-met' : ''}>이번 주 {doneThisWeek}/{target}회</span>}
        <span>누적 {totalDone(habit)}회</span>
        {streak.missedLast && !todayLog && <span className="habit-warn">지난번에 빠졌어요. 두 번 연속만 피하면 이어져요</span>}
      </>}
      {!notStarted && <span className="habit-today-actions">
        {todayLog
          ? <button type="button" className="block-manage-btn" disabled={check.isPending(habit, today)}
            onClick={() => check.save(habit, today, null)}>오늘 기록 취소</button>
          : <>
            <button type="button" className="habit-do-btn" disabled={check.isPending(habit, today)}
              onClick={() => check.save(habit, today, 'full')}>오늘 완료</button>
            {habit.tinyVersion && <button type="button" className="block-manage-btn" disabled={check.isPending(habit, today)}
              onClick={() => check.save(habit, today, 'tiny')}>최소만</button>}
          </>}
      </span>}
    </footer>
    {check.isCelebrating(habit, today) && <span className="habit-confetti" aria-hidden="true">🎉</span>}
  </article>;
}
