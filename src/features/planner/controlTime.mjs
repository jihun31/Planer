import { blockMinutes } from './scheduleTime.mjs';

// Keep the saved leisure record intact so later edits to study time are reflected immediately.
export function excludeStudyTime(blocks, studyBlocks) {
  const studyByDate = new Map();
  for (const block of studyBlocks) {
    const { startMin, endMin } = blockMinutes(block);
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) continue;
    const intervals = studyByDate.get(block.date) || [];
    intervals.push({ startMin, endMin });
    studyByDate.set(block.date, intervals);
  }
  return blocks.flatMap(block => {
    const { startMin, endMin } = blockMinutes(block);
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) return [];
    let parts = [{ startMin, endMin }];
    for (const study of studyByDate.get(block.date) || []) {
      parts = parts.flatMap(part => {
        if (study.endMin <= part.startMin || study.startMin >= part.endMin) return [part];
        const left = part.startMin < study.startMin ? [{ startMin: part.startMin, endMin: study.startMin }] : [];
        const right = study.endMin < part.endMin ? [{ startMin: study.endMin, endMin: part.endMin }] : [];
        return [...left, ...right];
      });
    }
    return parts.map(part => ({ ...block, ...part }));
  });
}

export function overlapsStudy(block, studyBlocks) {
  const { startMin, endMin } = blockMinutes(block);
  return studyBlocks.some(study => {
    if (study.date !== block.date) return false;
    const interval = blockMinutes(study);
    return startMin < interval.endMin && interval.startMin < endMin;
  });
}
