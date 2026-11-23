import { HabitHistoryDetail } from './HabitHistory';
import {
  DAY_STATE_TEXT, WEEKDAY_LABELS, automaticityOf, countLabel, countOf, isCountHabit, monthCells, monthDayCells,
  periodProgress, scheduleLabel, shortDay, statusOf, streakOf, totalDone, weekCells,
} from '../../features/habits/habitCore.mjs';

export function StreakBadge({ habit, today }) {
  const { count, unit } = streakOf(habit, today);
  if (!count) return null;
  return <span className="habit-streak" title="해야 하는 날을 한 번 빠져도 이어지고, 두 번 연속 빠지면 끊겨요. 쉬는 날은 건너뛰어요">🔥 {count}{unit}</span>;
}

// 오늘 기록 버튼: 일반 습관은 완료·최소·쉬기, 횟수 습관은 −1·+1·쉬기.
// compact(오늘 탭·습관 줄 펼침)에서는 동그라미 버튼이 완료·+1·쉬기 취소를 맡으므로 나머지만 보인다.
export function TodayActions({ habit, today, check, compact = false }) {
  const status = statusOf(habit, today);
  const busy = check.isPending(habit, today);
  if (status === 'skip') return compact ? null : <span className="habit-today-actions">
    <span className="habit-state-label habit-rest-label">– 오늘은 쉬는 날</span>
    <button type="button" className="habit-undo-btn" disabled={busy} aria-label="쉬기 취소"
      onClick={() => check.save(habit, today, null)}>취소</button>
  </span>;
  if (isCountHabit(habit)) {
    const n = countOf(habit, today);
    return <span className="habit-today-actions">
      {!compact && <span className={`habit-count ${status === 'full' ? 'habit-met' : ''}`}>오늘 {countLabel(habit, n)}</span>}
      {n > 0 && <button type="button" className="block-manage-btn" disabled={busy} aria-label={`${habit.name} 1 빼기`}
        onClick={() => check.step(habit, today, -1)}>−1</button>}
      {!compact && <button type="button" className="habit-do-btn" disabled={busy} aria-label={`${habit.name} 1 더하기`}
        onClick={() => check.step(habit, today, 1)}>+1</button>}
      {n === 0 && <button type="button" className="block-manage-btn" disabled={busy} onClick={() => check.save(habit, today, 'skip')}>쉬기</button>}
    </span>;
  }
  // 기록한 뒤에도 같은 높이를 지키도록 버튼 자리에 상태 표시와 작은 취소 버튼을 둔다
  if (status) return compact ? null : <span className="habit-today-actions">
    <span className={`habit-state-label ${status}`}>{status === 'tiny' ? '◐ 최소만 했어요' : '✓ 오늘 완료'}</span>
    <button type="button" className="habit-undo-btn" disabled={busy} aria-label="오늘 기록 취소"
      onClick={() => check.save(habit, today, null)}>취소</button>
  </span>;
  return <span className="habit-today-actions">
    {!compact && <button type="button" className="habit-do-btn" disabled={busy} onClick={() => check.save(habit, today, 'full')}>오늘 완료</button>}
    {habit.tinyVersion && <button type="button" className="block-manage-btn" disabled={busy} title={habit.tinyVersion}
      onClick={() => check.save(habit, today, 'tiny')}>최소만</button>}
    <button type="button" className="block-manage-btn" disabled={busy} title="연속 기록에 넣지도, 끊지도 않아요"
      onClick={() => check.save(habit, today, 'skip')}>쉬기</button>
  </span>;
}

const CHECK_MARK = { full: '✓', tiny: '◐', skip: '💤' };

// 오늘 기록 동그라미: 일반 습관은 완료/취소, 횟수 습관은 +1, 쉬는 날이면 쉬기 취소.
// 오늘 탭과 습관 탭의 줄이 같이 쓴다.
export function HabitCheck({ habit, today, check }) {
  const status = statusOf(habit, today);
  const counting = isCountHabit(habit) && status !== 'skip';
  const press = () => {
    if (status === 'skip') return check.save(habit, today, null);
    if (isCountHabit(habit)) return check.step(habit, today, 1);
    return check.save(habit, today, status ? null : 'full');
  };
  const label = status === 'skip' ? `${habit.name} 쉬기 취소` : isCountHabit(habit) ? `${habit.name} 1 더하기`
    : status ? `${habit.name} 기록 취소` : `${habit.name} 완료`;
  return <button type="button" className={`habit-check ${status ?? ''} ${counting ? 'count' : ''}`} disabled={check.isPending(habit, today)}
    aria-label={label} aria-pressed={Boolean(status)} onClick={press}>
    {counting ? (countOf(habit, today) || '+') : CHECK_MARK[status] ?? ''}
  </button>;
}

const MONTH_TEXT = { full: '목표 달성', open: '이번 달 진행 중', missed: '목표 못 채움', skip: '쉬는 달', before: '시작 전' };

function DayDot({ habit, cell, today, check, label }) {
  const count = isCountHabit(habit) ? countOf(habit, cell.day) : 0;
  return <button type="button" className={`habit-day-dot ${cell.state} ${cell.day === today ? 'today' : ''}`}
    disabled={!cell.editable || check.isPending(habit, cell.day)}
    title={`${label} · ${DAY_STATE_TEXT[cell.state]}${count ? ` ${countLabel(habit, count)}` : ''}${cell.editable ? ' (눌러서 바꾸기)' : ''}`}
    aria-label={`${label} ${DAY_STATE_TEXT[cell.state]}`} onClick={() => check.cycle(habit, cell.day)}><i aria-hidden="true" /></button>;
}

// 기록 점 7개: 매일·요일·주 N회는 이번 주 월~일, 날짜 지정은 해야 하는 날 7번, 월 N회는 최근 7달
function HabitDots({ habit, today, check }) {
  const type = habit.schedule?.type;
  if (type === 'monthly') return <span className="habit-row-dots" role="group" aria-label={`${habit.name} 최근 달 기록`}>
    {monthCells(habit, today).map(m => <span key={m.first} className={`habit-day-dot month ${m.state} ${m.current ? 'today' : ''}`}
      title={`${m.month}월 · ${MONTH_TEXT[m.state]}${m.state === 'before' ? '' : ` (${m.done}/${m.target}회)`}`}><i aria-hidden="true" /></span>)}
  </span>;
  if (type === 'monthdays') return <span className="habit-row-dots" role="group" aria-label={`${habit.name} 해야 하는 날 기록`}>
    {monthDayCells(habit, today).map(cell => <DayDot key={cell.day} habit={habit} cell={cell} today={today} check={check}
      label={shortDay(cell.day)} />)}
  </span>;
  return <span className="habit-row-dots" role="group" aria-label={`${habit.name} 이번 주 기록`}>
    {weekCells(habit, today).map(cell => <DayDot key={cell.day} habit={habit} cell={cell} today={today} check={check}
      label={`${WEEKDAY_LABELS[cell.weekday]}요일 ${shortDay(cell.day)}`} />)}
  </span>;
}

const PencilIcon = () => <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor"
  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  <path d="M15.2 5.2l3.6 3.6M4 20l1-4.6L15.6 4.8a1.4 1.4 0 0 1 2 0l1.6 1.6a1.4 1.4 0 0 1 0 2L8.6 19 4 20z" />
</svg>;

// 습관 탭의 한 줄: 동그라미 · 이름과 빈도·트리거 · 기록 점 · 연속 기록. 이름을 누르면 아래로 상세가 펼쳐진다.
export default function HabitRow({ habit, today, check, open, onToggle, onEdit }) {
  const notStarted = today < habit.startDate;
  const progress = periodProgress(habit, today);
  const celebrating = check.isCelebrating(habit, today);
  const meta = [scheduleLabel(habit.schedule) + (isCountHabit(habit) ? ` · 하루 ${habit.target.value}${habit.target.unit || '회'}` : ''),
    notStarted ? `${habit.startDate}에 시작해요` : habit.anchor].filter(Boolean).join(' · ');
  const detailId = `habit-detail-${habit.id}`;

  return <li className={`habit-row ${statusOf(habit, today) ?? ''} ${open ? 'open' : ''} ${celebrating ? 'celebrate' : ''}`}>
    <div className="habit-row-main">
      {notStarted ? <span className="habit-check waiting" aria-hidden="true" /> : <HabitCheck habit={habit} today={today} check={check} />}
      <button type="button" className="habit-row-toggle" aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
        <span className="habit-row-name">{habit.emoji && <span className="habit-emoji" aria-hidden="true">{habit.emoji} </span>}{habit.name}</span>
        <span className="habit-row-meta" title={meta}>{meta}</span>
      </button>
      <HabitDots habit={habit} today={today} check={check} />
      <span className="habit-row-badges">
        <StreakBadge habit={habit} today={today} />
        {automaticityOf(habit).settled && <span className="habit-settled" role="img" aria-label="자리 잡음"
          title="자리 잡음: 자동화 점검에서 두 번 연속 4점 이상">🌳</span>}
      </span>
    </div>

    {open && <div className="habit-row-detail" id={detailId}>
      <div className="habit-detail-bar">
        <span className="habit-detail-facts">
          {habit.anchor && <span>⏰ {habit.anchor}</span>}
          {habit.tinyVersion && <span>최소: {habit.tinyVersion}</span>}
          {!notStarted && progress && <span className={progress.done >= progress.target ? 'habit-met' : ''}>
            {progress.label} {progress.done}/{progress.target}회</span>}
          <span>누적 {totalDone(habit)}회</span>
        </span>
        {!notStarted && <TodayActions habit={habit} today={today} check={check} compact />}
        <button type="button" className="block-manage-btn habit-detail-edit" aria-label="수정" title="수정·보관" onClick={onEdit}>
          <PencilIcon /> 수정</button>
      </div>
      <HabitHistoryDetail habit={habit} today={today} />
    </div>}

    {celebrating && <span className="habit-confetti" aria-hidden="true">🎉</span>}
  </li>;
}
