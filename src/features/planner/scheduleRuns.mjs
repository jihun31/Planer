import { blockActivity } from './activityHistory.mjs';

// Join the visible minutes, rather than stored documents: overlapping records
// and legacy time formats have already been resolved by the timetable.
export function scheduleRunCells(minMap, activityMap, oppositeActivityMap) {
  const cells = new Map();
  let previous;
  for (const minute of Object.keys(minMap).map(Number).sort((a, b) => a - b)) {
    const block = minMap[minute];
    const activities = block._opposite ? oppositeActivityMap : activityMap;
    const info = blockActivity(block, activities);
    const opposite = Boolean(block._opposite);
    const group = block.group || activities[block.activityId]?.group;
    const same = previous && previous.endMin === minute
      && previous.opposite === opposite && previous.group === group
      && previous.info.key === info.key && info.key !== 'unknown'
      && previous.info.name === info.name && previous.info.color === info.color;
    if (same) previous.endMin = minute + 1;
    else previous = { startMin: minute, endMin: minute + 1, info, opposite, group };
    cells.set(minute, previous);
  }
  return cells;
}
