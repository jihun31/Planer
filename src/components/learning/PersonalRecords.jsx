import { dateShift, duration } from '../../features/learning/learningStats.mjs';
import CumulativeGrowth from './CumulativeGrowth.jsx';

const fullDate = date => `${date.slice(0,4)}.${Number(date.slice(5,7))}.${Number(date.slice(8,10))}`;
const weekLabel = date => {
  const end = dateShift(date,6);
  return `${fullDate(date)} – ${end.slice(0,4) !== date.slice(0,4) ? `${end.slice(0,4)}.` : ''}${Number(end.slice(5,7))}.${Number(end.slice(8,10))}`;
};

export default function PersonalRecords({ records }) {
  const {bestMonth,bestWeek,topActivity,growth,totalMinutes,today} = records;
  return <section className="learning-card learning-records" aria-labelledby="learning-records-title">
    <div className="learning-card-heading"><div><h2 id="learning-records-title">개인 최고 기록</h2>
      <p>나의 최고 기록과 누적 학습 시간</p></div></div>
    <dl className="learning-record-summary">
      <div><dt>가장 많이 목표를 달성한 달</dt>
        <dd><strong>{bestMonth ? `${bestMonth.days}일 달성` : '아직 기록이 없어요'}</strong>
          <span>{bestMonth ? `${bestMonth.month.slice(0,4)}년 ${Number(bestMonth.month.slice(5,7))}월` : '하루 목표를 달성하며 시작해 보세요.'}</span></dd>
      </div>
      <div><dt>가장 많이 학습한 주</dt>
        <dd><strong>{bestWeek ? duration(bestWeek.minutes) : '—'}</strong>
          <span>{bestWeek ? weekLabel(bestWeek.week) : '학습을 기록하면 표시됩니다.'}</span></dd>
      </div>
      <div><dt>가장 많이 학습한 활동</dt>
        <dd><strong>{topActivity ? duration(topActivity.totalMinutes) : '—'}</strong>
          <span className="learning-record-activity" title={topActivity?.name}>
            {topActivity && <i className="learning-record-dot" style={{background:topActivity.color}} />}
            {topActivity?.name || '학습에 포함된 활동을 기준으로 집계합니다.'}
          </span></dd>
      </div>
    </dl>
    <CumulativeGrowth growth={growth} totalMinutes={totalMinutes} today={today} />
    <p className="learning-caption">학습에 포함된 기록만 반영하며, 기록을 수정하거나 삭제하면 다시 계산합니다. 같은 최고 기록은 최근 기간을 표시합니다.</p>
  </section>;
}
