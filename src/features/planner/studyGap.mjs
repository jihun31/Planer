import { blockMinutes, plannerDate } from './scheduleTime.mjs';
import { isStudyBlock } from './blockKind.mjs';
import { excludeStudyTime } from './controlTime.mjs';

// Use the actual timer start, independently of the calendar currently on screen.
export function studyGap(blocks,startTs) {
  const date = plannerDate(startTs);
  const [year,month,day] = date.split('-').map(Number);
  const base = new Date(year,month - 1,day,8).getTime();
  const endMin = Math.round((startTs - base) / 60000);
  const rows = blocks.filter(block => block.date === date);
  let lastEnd = null;
  for (const block of rows.filter(isStudyBlock)) {
    const interval = blockMinutes(block);
    if (!Number.isFinite(interval.startMin) || !Number.isFinite(interval.endMin)
      || interval.endMin <= interval.startMin || interval.startMin >= endMin) continue;
    // An ongoing/overlapping study entry means there is no unrecorded gap.
    if (interval.endMin >= endMin) return null;
    lastEnd = Math.max(lastEnd ?? -Infinity,interval.endMin);
  }
  if (lastEnd === null) return null;
  const segments = excludeStudyTime([{date,startMin:lastEnd,endMin}],rows);
  return segments.length ? {date,startTs,segments} : null;
}

export function gapClock(date,minute) {
  const [year,month,day] = date.split('-').map(Number);
  const time = new Date(year,month - 1,day,8,minute);
  return `${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}`;
}
