import { AutomaticityCheck } from './AutomaticityCheck';
import {
  DAY_STATE_TEXT, WEEKDAY_LABELS, automaticityOf, countLabel, countOf, isCountHabit, monthCells, monthDayCells,
  periodProgress, scheduleLabel, shortDay, statusOf, streakOf, totalDone, weekCells,
} from '../../features/habits/habitCore.mjs';

const CELL_TEXT = DAY_STATE_TEXT;
const CELL_MARK = { full: '●', tiny: '◐', skip: '–', missed: '×', open: '○', empty: '', future: '·', off: '', before: '' };

export function StreakBadge({ habit, today }) {
  const { count, unit } = streakOf(habit, today);
  if (!count) return null;
  return <span className="habit-streak" title="해야 하는 날을 한 번 빠져도 이어지고, 두 번 연속 빠지면 끊겨요. 쉬는 날은 건너뛰어요">🔥 {count}{unit}</span>;
}

// 오늘 기록 버튼: 일반 습관은 완료·최소·쉬기, 횟수 습관은 −1·+1·쉬기.
// compact(오늘 탭)에서는 동그라미 버튼이 완료·+1·쉬기 취소를 맡으므로 나머지만 보인다.
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

const PencilIcon = () => <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor"
  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  <path d="M15.2 5.2l3.6 3.6M4 20l1-4.6L15.6 4.8a1.4 1.4 0 0 1 2 0l1.6 1.6a1.4 1.4 0 0 1 0 2L8.6 19 4 20z" />
</svg>;

function DayCell({ habit, cell, today, check, label, ariaLabel }) {
  const count = isCountHabit(habit) ? countOf(habit, cell.day) : 0;
  return <button type="button" className={`habit-cell ${cell.state} ${cell.day === today ? 'today' : ''}`}
    disabled={!cell.editable || check.isPending(habit, cell.day)}
    title={`${shortDay(cell.day)} · ${CELL_TEXT[cell.state]}${count ? ` ${countLabel(habit, count)}` : ''}${cell.editable ? ' (눌러서 바꾸기)' : ''}`}
    aria-label={`${ariaLabel} ${CELL_TEXT[cell.state]}`} onClick={() => check.cycle(habit, cell.day)}>
    <span className="habit-cell-day">{label}</span>
    <span className="habit-cell-mark" aria-hidden="true">{CELL_MARK[cell.state]}</span>
  </button>;
}

const MONTH_TEXT = { full: '목표 달성', open: '이번 달 진행 중', missed: '목표 못 채움', skip: '쉬는 달', before: '시작 전' };

// 기록 칸: 매일·요일·주 N회는 이번 주 7일, 날짜 지정은 해야 하는 날 7번, 월 N회는 최근 7달
function HabitStrip({ habit, today, check }) {
  const type = habit.schedule?.type;
  if (type === 'monthly') return <div className="habit-week" role="group" aria-label={`${habit.name} 최근 달 기록`}>
    {monthCells(habit, today).map(m => {
      const mark = m.state === 'full' ? '●' : m.state === 'before' ? '' : m.state === 'skip' ? '–' : `${m.done}/${m.target}`;
      return <span key={m.first} className={`habit-cell month ${m.state} ${m.current ? 'today' : ''}`}
        title={`${m.month}월 · ${MONTH_TEXT[m.state]}${m.state === 'before' ? '' : ` (${m.done}/${m.target}회)`}`}>
        <span className="habit-cell-day">{m.month}월</span>
        <span className="habit-cell-mark">{mark}</span>
      </span>;
    })}
  </div>;
  if (type === 'monthdays') return <div className="habit-week" role="group" aria-label={`${habit.name} 해야 하는 날 기록`}>
    {monthDayCells(habit, today).map(cell => <DayCell key={cell.day} habit={habit} cell={cell} today={today} check={check}
      label={shortDay(cell.day)} ariaLabel={shortDay(cell.day)} />)}
  </div>;
  return <div className="habit-week" role="group" aria-label={`${habit.name} 이번 주 기록`}>
    {weekCells(habit, today).map(cell => <DayCell key={cell.day} habit={habit} cell={cell} today={today} check={check}
      label={WEEKDAY_LABELS[cell.weekday]} ariaLabel={`${WEEKDAY_LABELS[cell.weekday]}요일`} />)}
  </div>;
}

export default function HabitCard({ uid, habit, today, check, onEdit, onAutomaticity }) {
  const streak = streakOf(habit, today);
  const notStarted = today < habit.startDate;
  const progress = periodProgress(habit, today);
  const info = [habit.anchor && `⏰ ${habit.anchor}`, habit.tinyVersion && `최소: ${habit.tinyVersion}`].filter(Boolean).join(' · ');

  return <article className={`habit-card ${check.isCelebrating(habit, today) ? 'celebrate' : ''}`}>
    {/* 제목 · 빈도 · 연속 기록 · 연필 버튼을 한 줄에. 제목만 줄어들어서(최대 두 줄) 오른쪽 요소가 밀리지 않는다 */}
    <header className="habit-card-hdr">
      <h3 className="habit-card-title" title={habit.name}>
        {habit.emoji && <span className="habit-emoji">{habit.emoji}</span>}<span className="habit-card-name">{habit.name}</span>
      </h3>
      <span className="habit-badge">{scheduleLabel(habit.schedule)}{isCountHabit(habit) && ` · 하루 ${habit.target.value}${habit.target.unit || '회'}`}</span>
      <StreakBadge habit={habit} today={today} />
      {!notStarted && streak.missedLast && !statusOf(habit, today) &&
        <span className="habit-warn" role="img" aria-label="지난번에 빠졌어요" title="지난번에 빠졌어요. 두 번 연속만 피하면 연속 기록이 이어져요">⚠</span>}
      {automaticityOf(habit).settled && <span className="habit-settled" role="img" aria-label="자리 잡음"
        title="자리 잡음: 자동화 점검에서 두 번 연속 4점 이상">🌳</span>}
      <button type="button" className="habit-edit-btn" aria-label="수정" title="수정·보관" onClick={onEdit}><PencilIcon /></button>
    </header>

    {/* 트리거·최소 버전은 한 줄. 없어도 자리를 남겨 카드끼리 기록 칸 높이를 맞춘다 */}
    <p className="habit-info" title={info || undefined}>
      {habit.anchor && <span className="habit-anchor">⏰ {habit.anchor}</span>}
      {habit.tinyVersion && <span className="habit-tiny">최소: {habit.tinyVersion}</span>}
    </p>

    <HabitStrip habit={habit} today={today} check={check} />

    {onAutomaticity && <AutomaticityCheck uid={uid} habit={habit} today={today} onAnswer={onAutomaticity} />}

    <footer className="habit-card-foot">
      {notStarted ? <span>{habit.startDate}에 시작해요</span> : <>
        {progress && <span className={progress.done >= progress.target ? 'habit-met' : ''}>
          {progress.label} {progress.done}/{progress.target}회</span>}
        <span>누적 {totalDone(habit)}회</span>
        <TodayActions habit={habit} today={today} check={check} />
      </>}
    </footer>

    {check.isCelebrating(habit, today) && <span className="habit-confetti" aria-hidden="true">🎉</span>}
  </article>;
}
