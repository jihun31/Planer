import { AutomaticityTrend } from './AutomaticityCheck';
import {
  DAY_STATE_TEXT, combinedHistory, completion, historyWeeks, overallCompletion, percent, shortDay,
} from '../../features/habits/habitCore.mjs';

const DAY_LABELS = ['월', '', '수', '', '금', '', '일'];

// 달이 바뀌는 주에만 달 이름을 단다. 첫 주는 바로 다음 주에 달이 바뀌면 글자가 겹쳐서 뺀다
function monthLabels(weeks) {
  const monthOf = week => Number(week.monday.slice(5, 7));
  return weeks.map((week, i) => {
    if (i === 0) return weeks.length > 1 && monthOf(weeks[1]) !== monthOf(week) ? '' : `${monthOf(week)}월`;
    return monthOf(week) !== monthOf(weeks[i - 1]) ? `${monthOf(week)}월` : '';
  });
}

// 26주 히트맵 격자. cell(day) → { className, title }
function BigMap({ weeks, today, label, cell }) {
  const months = monthLabels(weeks);
  return <div className="habit-bigmap" role="img" aria-label={label}>
    <div className="habit-bigmap-days" aria-hidden="true">
      <span className="habit-bigmap-month" />
      {DAY_LABELS.map((d, i) => <span key={i} className="habit-bigmap-day">{d}</span>)}
    </div>
    {weeks.map((week, i) => <div key={week.monday} className="habit-bigmap-week">
      <span className="habit-bigmap-month" aria-hidden="true">{months[i]}</span>
      {week.days.map(d => {
        const { className, title } = cell(d);
        return <span key={d.day} className={`habit-heat ${className} ${d.day === today ? 'today' : ''}`} title={title} />;
      })}
    </div>)}
  </div>;
}

// 습관 줄을 펼쳤을 때 보이는 그 습관의 최근 26주 기록
export function HabitHistoryDetail({ habit, today }) {
  const weeks = historyWeeks(habit, today);
  const rate = completion(habit, weeks[0].monday, today, today);
  return <div className="habit-history-body">
    <BigMap weeks={weeks} today={today} label={`${habit.name} 최근 ${weeks.length}주 달성률 ${percent(rate.rate)}`}
      cell={d => ({ className: d.state, title: `${shortDay(d.day)} · ${DAY_STATE_TEXT[d.state]}` })} />
    <div className="habit-history-stats">
      <div className="habit-history-stat">
        <span>최근 {weeks.length}주 달성률</span>
        <strong>{percent(rate.rate)}</strong>
        <em>{rate.done}/{rate.total}</em>
      </div>
      <AutomaticityTrend habit={habit} />
      <div className="habit-heatmap-legend" aria-hidden="true">
        <span><i className="habit-heat full" />완료</span><span><i className="habit-heat tiny" />최소</span>
        <span><i className="habit-heat skip" />쉬는 날</span><span><i className="habit-heat missed" />빠짐</span>
      </div>
    </div>
  </div>;
}

// 습관 탭 아래: 모든 습관을 합친 최근 26주. 날마다 해야 했던 습관 중 한 비율을 진하기로 보여 준다.
export default function HabitOverview({ habits, today }) {
  const weeks = combinedHistory(habits, today);
  if (!weeks.length) return null;
  const rate = overallCompletion(habits, weeks[0].monday, today, today);
  return <section className="habit-history-panel" aria-label={`전체 습관 최근 ${weeks.length}주 기록`}>
    <h3 className="habit-history-title">📅 최근 {weeks.length}주 전체 기록</h3>
    <div className="habit-history-body">
      <BigMap weeks={weeks} today={today} label={`전체 습관 최근 ${weeks.length}주 달성률 ${percent(rate.rate)}`}
        cell={d => ({
          className: d.future ? 'future' : d.level === null ? 'none' : `l${d.level}`,
          title: `${shortDay(d.day)} · ${d.future ? '예정' : d.due ? `${d.done}/${d.due}개 함` : '할 습관 없음'}`,
        })} />
      <div className="habit-history-stats">
        <div className="habit-history-stat">
          <span>전체 달성률</span>
          <strong>{percent(rate.rate)}</strong>
          <em>{rate.done}/{rate.total}</em>
        </div>
        <p className="habit-history-hint">습관 이름을 누르면 습관별 기록이 펼쳐져요.</p>
        <div className="habit-heatmap-legend" aria-hidden="true">
          <span>못 함 <i className="habit-heat l0" /><i className="habit-heat l1" /><i className="habit-heat l2" />
            <i className="habit-heat l3" /><i className="habit-heat l4" /> 모두 함</span>
          <span><i className="habit-heat none" />할 습관 없음</span>
        </div>
      </div>
    </div>
  </section>;
}
