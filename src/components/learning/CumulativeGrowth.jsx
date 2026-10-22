import { useId } from 'react';
import { duration } from '../../features/learning/learningStats.mjs';

const dayMs = 86400000;
const timestamp = date => Date.parse(`${date}T00:00:00Z`);
const dateLabel = time => {
  const date = new Date(time).toISOString().slice(0,10);
  return `${date.slice(0,4)}.${Number(date.slice(5,7))}.${Number(date.slice(8,10))}`;
};

export default function CumulativeGrowth({ growth, totalMinutes, today }) {
  const id = useId();
  if (!growth.length) return <div className="learning-growth">
    <h3>누적 성장</h3>
    <p className="learning-growth-empty">학습을 기록하면 쌓여 가는 시간이 그래프로 표시됩니다.</p>
  </div>;
  const first = timestamp(growth[0].date)-dayMs;
  const last = timestamp(today);
  const unit = 10 ** Math.floor(Math.log10(Math.max(1,totalMinutes/60)))/2;
  const maximum = Math.max(60,Math.ceil(totalMinutes/60/unit)*unit*60);
  const x = time => (time-first)/(last-first)*1000;
  const y = minutes => 168-minutes/maximum*156;
  // Insert the day before each record so gaps remain flat instead of implying study.
  const points = [{time:first,minutes:0}];
  for (const day of growth) {
    const time = timestamp(day.date), previous = points.at(-1);
    if (time-previous.time > dayMs) points.push({time:time-dayMs,minutes:previous.minutes});
    points.push({time,minutes:day.minutes});
  }
  if (points.at(-1).time < last) points.push({time:last,minutes:totalMinutes});
  const line = points.map((point,index) => `${index ? 'L' : 'M'}${x(point.time).toFixed(2)},${y(point.minutes).toFixed(2)}`).join(' ');
  const ticks = [...new Set(Array.from({length:4},(_,i) => Math.round((first+(last-first)*i/3)/dayMs)*dayMs))];
  return <div className="learning-growth">
    <div className="learning-growth-heading"><h3>누적 성장</h3><span>지금까지 <strong>{duration(totalMinutes)}</strong></span></div>
    <div className="learning-growth-chart">
      <div className="learning-growth-scale" aria-hidden="true"><span>{duration(maximum)}</span><span>{duration(maximum/2)}</span><span>0시간</span></div>
      <div className="learning-growth-plot">
        <svg viewBox="0 0 1000 180" preserveAspectRatio="none" role="img" aria-label={`${growth[0].date}부터 ${today}까지 누적 학습 ${duration(totalMinutes)}`}>
          <defs><linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#609b7e" stopOpacity=".25" /><stop offset="1" stopColor="#609b7e" stopOpacity=".02" /></linearGradient></defs>
          {[12,90,168].map(level => <line key={level} x1="0" y1={level} x2="1000" y2={level} className="learning-growth-gridline" />)}
          <path d={`${line} L1000,168 L0,168 Z`} fill={`url(#${id}-area)`} />
          <path d={line} fill="none" stroke="#478369" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <span className="learning-growth-endpoint" style={{top:`${y(totalMinutes)/180*100}%`}} aria-hidden="true" />
      </div>
      <div className="learning-growth-dates" aria-hidden="true">{ticks.map(time => <span key={time}>{dateLabel(time)}</span>)}</div>
    </div>
  </div>;
}
