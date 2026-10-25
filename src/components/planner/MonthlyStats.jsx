import { useMemo } from 'react';
import { controlColor } from '../../features/planner/controlColors.mjs';
import { summarizeBlocks } from '../../features/planner/activityHistory.mjs';
import { blockMinutes as getBlockMins } from '../../features/planner/scheduleTime.mjs';
import { fmtMins } from './plannerDisplay.mjs';

function MonthlyStats({ year, month, blocks, activities, control = false,loading=false,error=null }) {
  const actMap      = useMemo(() => Object.fromEntries(activities.map(a => [a.id, a])), [activities]);
  const prefix      = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthBlocks = blocks.filter(block => {
    if (!block.date?.startsWith(prefix)) return false;
    const { startMin, endMin } = getBlockMins(block);
    return Number.isFinite(startMin) && Number.isFinite(endMin) && endMin > startMin;
  });

  const stats = useMemo(() => summarizeBlocks(monthBlocks, actMap), [monthBlocks, actMap]);
  const grouped = useMemo(() => {
    const groups = { controlled: { key: 'controlled', name: '통제', mins: 0, items: [] }, foolish: { key: 'foolish', name: '어리석음', mins: 0, items: [] } };
    for (const block of monthBlocks) {
      const group = block.group || actMap[block.activityId]?.group || 'controlled';
      const bucket = groups[group] || groups.controlled;
      const mins = getBlockMins(block).endMin - getBlockMins(block).startMin;
      if (Number.isFinite(mins) && mins > 0) bucket.mins += mins;
    }
    for (const [key, bucket] of Object.entries(groups))
      bucket.items = summarizeBlocks(monthBlocks.filter(block =>
        (block.group || actMap[block.activityId]?.group || 'controlled') === key), actMap);
    return Object.values(groups);
  }, [monthBlocks, actMap]);

  const maxH = stats.length ? stats[0].hours : 1;

  return (
    <div className="monthly-stats" aria-busy={loading}>
      <p className="stats-title">📊 {month + 1}월 통계</p>
      {loading||error?<p className="stats-empty">{loading?'통계를 불러오는 중…':'통계를 불러오지 못했습니다.'}</p>:stats.length === 0 ? (
        <p className="stats-empty">이번 달 기록이 없습니다.</p>
      ) : (
        <div className="stats-list">
          {(control ? grouped.flatMap(group => [
            <div className="stats-group" key={`group-${group.name}`} style={{ color: controlColor(group.key) }}>
              <strong>{group.name}</strong><span>{fmtMins(group.mins)}</span>
            </div>,
            ...group.items.map(s => (
              <div key={`${group.name}-${s.key}`} className="stats-row stats-activity-row">
                <span className="stats-name" style={{ color: s.color }} title={s.name}>{s.name}</span>
                <div className="stats-bar-bg"><div className="stats-bar-fill" style={{ width: `${(s.hours / maxH) * 100}%`, background: s.color }} /></div>
                <span className="stats-hr">{s.hours.toFixed(1)}h</span>
              </div>
            )),
          ]) : stats.map(s => (
            <div key={s.key} className="stats-row">
              <span className="stats-name" style={{ color: s.color }} title={s.name}>{s.name}</span>
              <div className="stats-bar-bg">
                <div className="stats-bar-fill"
                  style={{ width: `${(s.hours / maxH) * 100}%`, background: s.color }} />
              </div>
              <span className="stats-hr">{s.hours.toFixed(1)}h</span>
            </div>
          )))}
        </div>
      )}
    </div>
  );
}

export default MonthlyStats;
