import { useMemo } from 'react';
import { controlColor } from '../../features/planner/controlColors.mjs';
import { plannerDate as nowDateStr } from '../../features/planner/scheduleTime.mjs';

function PlannerCalendar({ year, month, selectedDate, blocks, oppositeBlocks, oppositeActivities, oppositeMode, onSelectDate, onMonthChange, control = false, todayDate, minimumWeeks = 0 }) {
  const DAY_LABELS  = ['일', '월', '화', '수', '목', '금', '토'];
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today       = todayDate ?? nowDateStr();

  const datesWithBlocks = useMemo(() => {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    return new Set(blocks.filter(b => b.date?.startsWith(prefix)).map(b => b.date));
  }, [blocks, year, month]);
  const oppositeByDate = useMemo(() => {
    const result = new Map();
    for (const block of oppositeBlocks) if (!result.has(block.date)) result.set(block.date, block);
    return result;
  }, [oppositeBlocks]);
  const oppositeActMap = useMemo(() => Object.fromEntries(oppositeActivities.map(a => [a.id, a])), [oppositeActivities]);

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let dd = 1; dd <= daysInMonth; dd++) cells.push(dd);
  while (cells.length < minimumWeeks * 7) cells.push(null);

  return (
    <div className="planner-cal">
      <div className="cal-header">
        <button className="cal-nav" onClick={() => onMonthChange(-1)}>‹</button>
        <span className="cal-title">{year}년 {month + 1}월</span>
        <button className="cal-nav" onClick={() => onMonthChange(1)}>›</button>
      </div>
      <div className="cal-grid">
        {DAY_LABELS.map(dl => <div key={dl} className="cal-day-label">{dl}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={`_${i}`} />;
          const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const oppositeBlock = oppositeByDate.get(ds);
          const showOpposite = oppositeBlock && oppositeMode !== 'hidden';
          const oppositeColor = oppositeBlock && controlColor(
            oppositeBlock.group || oppositeActMap[oppositeBlock.activityId]?.group);
          return (
            <button key={day}
              className={`cal-day ${ds === selectedDate ? 'cal-sel' : ''} ${ds === today ? 'cal-today' : ''}`}
              onClick={() => onSelectDate(ds)}
            >
              {day}
              {(datesWithBlocks.has(ds) || showOpposite) && <span className="cal-dots">
                {(control || datesWithBlocks.has(ds)) && <span className="cal-dot" />}
                {!control && showOpposite && <span className={`cal-dot cal-dot-opposite-${oppositeMode}`}
                  style={{ background: oppositeMode === 'blind' ? '#aeb7c5' : oppositeColor }} />}
              </span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default PlannerCalendar;
