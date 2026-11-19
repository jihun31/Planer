import { blockMinutes, plannerDate } from './scheduleTime.mjs';

// Use the actual timer start, independently of the calendar currently on screen.
// The gap starts at the latest recorded calendar block of any kind, so the
// preview and the save-time recheck never overlap an existing record.
export function studyGap(blocks,startTs) {
  const date = plannerDate(startTs);
  const [year,month,day] = date.split('-').map(Number);
  const base = new Date(year,month - 1,day,8).getTime();
  const endMin = Math.round((startTs - base) / 60000);
  let lastEnd = null;
  for (const block of blocks) {
    if (block.date !== date) continue;
    const interval = blockMinutes(block);
    if (!Number.isFinite(interval.startMin) || !Number.isFinite(interval.endMin)
      || interval.endMin <= interval.startMin || interval.startMin >= endMin) continue;
    // An ongoing/overlapping entry means there is no unrecorded gap.
    if (interval.endMin >= endMin) return null;
    lastEnd = Math.max(lastEnd ?? interval.endMin,interval.endMin);
  }
  if (lastEnd === null) return null;
  return {date,startTs,segments:[{date,startMin:lastEnd,endMin}]};
}

export function gapClock(date,minute) {
  const [year,month,day] = date.split('-').map(Number);
  const time = new Date(year,month - 1,day,8,minute);
  return `${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}`;
}
