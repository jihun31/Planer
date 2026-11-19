import { useState } from 'react';
import HabitBadges, { BadgeToast } from './HabitBadges';
import { AutomaticityCheck, AutomaticityTrend } from './AutomaticityCheck';
import {
  WEEKDAY_LABELS, automaticityOf, completion, countLabel, countOf, historyWeeks, isCountHabit, percent, scheduleLabel, shortDay,
  statusOf, streakOf, totalDone, weekCells, weekDoneCount, weekStart, weeklyTarget,
} from '../../features/habits/habitCore.mjs';

const CELL_TEXT = { full: '완료', tiny: '최소만 함', skip: '쉬는 날', missed: '빠짐', open: '아직 안 함', empty: '안 함',
  future: '예정', off: '쉬는 요일', before: '시작 전' };
const CELL_MARK = { full: '●', tiny: '◐', skip: '💤', missed: '×', open: '○', empty: '', future: '·', off: '–', before: '' };

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
    <span className="habit-rest-label">💤 오늘은 쉬는 날</span>
    <button type="button" className="block-manage-btn" disabled={busy} onClick={() => check.save(habit, today, null)}>쉬기 취소</button>
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
  if (status) return compact ? null : <span className="habit-today-actions">
    <button type="button" className="block-manage-btn" disabled={busy} onClick={() => check.save(habit, today, null)}>오늘 기록 취소</button>
  </span>;
  return <span className="habit-today-actions">
    {!compact && <button type="button" className="habit-do-btn" disabled={busy} onClick={() => check.save(habit, today, 'full')}>오늘 완료</button>}
    {habit.tinyVersion && <button type="button" className="block-manage-btn" disabled={busy} title={habit.tinyVersion}
      onClick={() => check.save(habit, today, 'tiny')}>최소만</button>}
    <button type="button" className="block-manage-btn" disabled={busy} title="연속 기록에 넣지도, 끊지도 않아요"
      onClick={() => check.save(habit, today, 'skip')}>쉬기</button>
  </span>;
}

function History({ habit, today }) {
  const weeks = historyWeeks(habit, today);
  const rate = completion(habit, weeks[0].monday, today, today);
  return <div className="habit-history">
    <div className="habit-history-head">
      <span>최근 {weeks.length}주</span>
      <span>달성률 <strong>{percent(rate.rate)}</strong> ({rate.done}/{rate.total})</span>
    </div>
    <div className="habit-heatmap" role="img" aria-label={`최근 ${weeks.length}주 달성률 ${percent(rate.rate)}`}>
      <div className="habit-heatmap-days" aria-hidden="true">{['월', '', '수', '', '금', '', '일'].map((d, i) => <span key={i}>{d}</span>)}</div>
      {weeks.map(week => <div key={week.monday} className="habit-heatmap-week">
        {week.days.map(d => <span key={d.day} className={`habit-heat ${d.state}`} title={`${shortDay(d.day)} · ${CELL_TEXT[d.state]}`} />)}
      </div>)}
    </div>
    <AutomaticityTrend habit={habit} />
    <div className="habit-heatmap-legend" aria-hidden="true">
      <span><i className="habit-heat full" />완료</span><span><i className="habit-heat tiny" />최소</span>
      <span><i className="habit-heat skip" />쉬는 날</span><span><i className="habit-heat missed" />빠짐</span>
    </div>
  </div>;
}

export default function HabitCard({ uid, habit, today, check, onEdit, onArchive, onAutomaticity }) {
  const [showHistory, setShowHistory] = useState(false);
  const streak = streakOf(habit, today);
  const notStarted = today < habit.startDate;
  const weekly = habit.schedule?.type === 'weekly';
  const target = weekly ? weeklyTarget(habit, weekStart(today)) : 0;
  const doneThisWeek = weekly ? weekDoneCount(habit, today) : 0;

  return <article className={`habit-card ${check.isCelebrating(habit, today) ? 'celebrate' : ''}`}>
    <header className="habit-card-hdr">
      <h3 className="habit-card-title">{habit.emoji && <span className="habit-emoji">{habit.emoji}</span>}{habit.name}</h3>
      <span className="habit-badge">{scheduleLabel(habit.schedule)}{isCountHabit(habit) && ` · 하루 ${habit.target.value}${habit.target.unit || '회'}`}</span>
      <StreakBadge habit={habit} today={today} />
      {automaticityOf(habit).settled && <span className="habit-settled" title="자동화 점검에서 두 번 연속 4점 이상">🌳 자리 잡음</span>}
      <span className="habit-card-menu">
        <button type="button" className="block-manage-btn" onClick={onEdit}>수정</button>
        <button type="button" className="block-manage-btn" onClick={onArchive} title="기록은 남기고 목록에서 뺍니다">보관</button>
      </span>
    </header>

    {habit.anchor && <p className="habit-anchor">⏰ {habit.anchor} → {habit.name}</p>}
    {habit.tinyVersion && <p className="habit-tiny">최소 버전: {habit.tinyVersion}</p>}
    {!notStarted && <HabitBadges habit={habit} />}

    <div className="habit-week" role="group" aria-label={`${habit.name} 이번 주 기록`}>
      {weekCells(habit, today).map(cell => <button key={cell.day} type="button"
        className={`habit-cell ${cell.state} ${cell.day === today ? 'today' : ''}`}
        disabled={!cell.editable || check.isPending(habit, cell.day)}
        title={`${shortDay(cell.day)} · ${CELL_TEXT[cell.state]}${isCountHabit(habit) && countOf(habit, cell.day) ? ` ${countLabel(habit, countOf(habit, cell.day))}` : ''}${cell.editable ? ' (눌러서 바꾸기)' : ''}`}
        aria-label={`${WEEKDAY_LABELS[cell.weekday]}요일 ${CELL_TEXT[cell.state]}`}
        onClick={() => check.cycle(habit, cell.day)}>
        <span className="habit-cell-day">{WEEKDAY_LABELS[cell.weekday]}</span>
        <span className="habit-cell-mark" aria-hidden="true">{CELL_MARK[cell.state]}</span>
      </button>)}
    </div>

    {onAutomaticity && <AutomaticityCheck uid={uid} habit={habit} today={today} onAnswer={onAutomaticity} />}

    <footer className="habit-card-foot">
      {notStarted ? <span>{habit.startDate}에 시작해요</span> : <>
        {weekly && <span className={doneThisWeek >= target ? 'habit-met' : ''}>이번 주 {doneThisWeek}/{target}회</span>}
        <span>누적 {totalDone(habit)}회</span>
        {streak.missedLast && !statusOf(habit, today) && <span className="habit-warn">지난번에 빠졌어요. 두 번 연속만 피하면 이어져요</span>}
        <TodayActions habit={habit} today={today} check={check} />
      </>}
    </footer>

    <button type="button" className="habit-history-toggle" aria-expanded={showHistory} onClick={() => setShowHistory(v => !v)}>
      {showHistory ? '기록 접기 ▲' : '기록 보기 ▼'}
    </button>
    {showHistory && <History habit={habit} today={today} />}
    <BadgeToast habit={habit} milestone={check.badgeFor(habit)} />
    {check.isCelebrating(habit, today) && <span className="habit-confetti" aria-hidden="true">🎉</span>}
  </article>;
}
