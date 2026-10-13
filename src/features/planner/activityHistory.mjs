export function blockHours(block) {
  if (block.startMin != null) return (block.endMin - block.startMin) / 60;
  if (block.startSlot != null) return (block.endSlot - block.startSlot) / 4;
  return (block.endHour || 0) - (block.startHour || 0);
}

export function blockActivity(block, activityMap) {
  const activity = activityMap[block.activityId];
  if (block.customName) return {
    key: 'custom:' + block.customName,
    name: block.customName, color: block.customColor || '#6b7280',
  };
  return {
    key: block.activityId ? 'activity:' + block.activityId : 'unknown',
    name: block.activityName || activity?.name || (block.activityId ? '삭제된 활동' : '이름 없는 활동'),
    color: block.activityColor || activity?.color || '#6b7280',
  };
}

export function summarizeBlocks(blocks, activityMap) {
  const totals = new Map();
  for (const block of blocks) {
    const mins = Math.round(blockHours(block) * 60);
    if (!Number.isFinite(mins) || mins <= 0) continue;
    const info = blockActivity(block, activityMap);
    const entry = totals.get(info.key) || { ...info, mins: 0, hours: 0 };
    entry.mins += mins;
    entry.hours = entry.mins / 60;
    totals.set(info.key, entry);
  }
  return [...totals.values()].sort((a, b) => b.mins - a.mins);
}
