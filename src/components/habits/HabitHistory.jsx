import { useState } from 'react';
import { AutomaticityTrend } from './AutomaticityCheck';
import { StreakBadge } from './HabitCard';
import { DAY_STATE_TEXT, completion, historyWeeks, percent, shortDay, totalDone } from '../../features/habits/habitCore.mjs';

const DAY_LABELS = ['월', '', '수', '', '금', '', '일'];

// 습관 탭 아래의 최근 26주 기록. 습관마다 카드에 넣지 않고 한 곳에서 크게 보고, 위 칩으로 습관을 바꾼다.
export default function HabitHistory({ habits, today }) {
  const [selectedId, setSelectedId] = useState(null);
  const habit = habits.find(h => h.id === selectedId) ?? habits[0];
  if (!habit) return null;
  const weeks = historyWeeks(habit, today);
  const rate = completion(habit, weeks[0].monday, today, today);
  // 달이 바뀌는 주에만 달 이름을 단다. 첫 주는 바로 다음 주에 달이 바뀌면 글자가 겹쳐서 뺀다
  const monthOf = week => Number(week.monday.slice(5, 7));
  const monthLabel = (week, i) => {
    if (i === 0) return weeks.length > 1 && monthOf(weeks[1]) !== monthOf(week) ? '' : `${monthOf(week)}월`;
    return monthOf(week) !== monthOf(weeks[i - 1]) ? `${monthOf(week)}월` : '';
  };

  return <section className="habit-history-panel" aria-label={`최근 ${weeks.length}주 기록`}>
    <div className="habit-history-panel-hdr">
      <h3 className="habit-history-title">📅 최근 {weeks.length}주 기록</h3>
      <div className="habit-history-tabs" role="tablist" aria-label="기록을 볼 습관">
        {habits.map(h => <button key={h.id} type="button" role="tab" aria-selected={h.id === habit.id}
          className={`habit-chip ${h.id === habit.id ? 'on' : ''}`} onClick={() => setSelectedId(h.id)}>
          {h.emoji && <span aria-hidden="true">{h.emoji} </span>}{h.name}
        </button>)}
      </div>
    </div>

    <div className="habit-history-body">
      <div className="habit-bigmap" role="img" aria-label={`${habit.name} 최근 ${weeks.length}주 달성률 ${percent(rate.rate)}`}>
        <div className="habit-bigmap-days" aria-hidden="true">
          <span className="habit-bigmap-month" />
          {DAY_LABELS.map((d, i) => <span key={i} className="habit-bigmap-day">{d}</span>)}
        </div>
        {weeks.map((week, i) => <div key={week.monday} className="habit-bigmap-week">
          <span className="habit-bigmap-month" aria-hidden="true">{monthLabel(week, i)}</span>
          {week.days.map(d => <span key={d.day} className={`habit-heat ${d.state} ${d.day === today ? 'today' : ''}`}
            title={`${shortDay(d.day)} · ${DAY_STATE_TEXT[d.state]}`} />)}
        </div>)}
      </div>

      <div className="habit-history-stats">
        <div className="habit-history-stat">
          <span>달성률</span>
          <strong>{percent(rate.rate)}</strong>
          <em>{rate.done}/{rate.total}일</em>
        </div>
        <div className="habit-history-stat">
          <span>누적</span>
          <strong>{totalDone(habit)}회</strong>
          <em><StreakBadge habit={habit} today={today} /></em>
        </div>
        <AutomaticityTrend habit={habit} />
        <div className="habit-heatmap-legend" aria-hidden="true">
          <span><i className="habit-heat full" />완료</span><span><i className="habit-heat tiny" />최소</span>
          <span><i className="habit-heat skip" />쉬는 날</span><span><i className="habit-heat missed" />빠짐</span>
        </div>
      </div>
    </div>
  </section>;
}
