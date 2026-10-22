// Stored minute offsets always retain the original 08:00 origin.
export const DEFAULT_RANGE = Object.freeze({ startHour: 8, endHour: 3 });
export function plannerDate(value = new Date()) {
  const d = new Date(value);
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  return localDate(d);
}
function localDate(d) {
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
export function shiftPlannerDate(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return localDate(new Date(year, month-1, day+days, 12));
}
export function validRange(range) {
  return Number.isInteger(range.startHour) && Number.isInteger(range.endHour)
    && range.startHour >= 0 && range.startHour < 24 && range.endHour >= 0 && range.endHour < 24;
}
export function rangeForDate(history, date) {
  return history.filter(v => validRange(v) && v.effectiveDate <= date)
    .sort((a,b) => a.effectiveDate.localeCompare(b.effectiveDate)
      || (a.createdAt?.toMillis?.() ?? a.changedAt ?? 0) - (b.createdAt?.toMillis?.() ?? b.changedAt ?? 0)
      || (a.id || '').localeCompare(b.id || '')).at(-1) || DEFAULT_RANGE;
}
export function blockMinutes(b) {
  return {
    startMin: b.startMin ?? (b.startSlot != null ? b.startSlot*15 : (b.startHour-8)*60),
    endMin: b.endMin ?? (b.endSlot != null ? b.endSlot*15 : (b.endHour-8)*60),
  };
}
export function visibleHours(range, blocks) {
  let first = range.startHour;
  let end = range.endHour <= first ? range.endHour+24 : range.endHour;
  for (const b of blocks) {
    const {startMin,endMin} = blockMinutes(b);
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) continue;
    first = Math.min(first, Math.floor(8+startMin/60));
    end = Math.max(end, Math.ceil(8+endMin/60));
  }
  return Array.from({length: end-first}, (_,i) => first+i);
}
export function clockLabel(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}
// Split at the existing 05:00 planner-day boundary, never at the visible grid edges.
export function timerSegments(startTs, endTs) {
  const result = [];
  let cursor = Math.round(startTs/60000)*60000;
  const end = Math.round(endTs/60000)*60000;
  while (cursor < end) {
    const date = plannerDate(cursor);
    const [y,m,d] = date.split('-').map(Number);
    const base = new Date(y,m-1,d,8).getTime();
    const nextDay = new Date(y,m-1,d+1,5).getTime();
    const stop = Math.min(end,nextDay);
    result.push({ date, startMin: Math.round((cursor-base)/60000), endMin: Math.round((stop-base)/60000) });
    cursor = stop;
  }
  return result;
}
