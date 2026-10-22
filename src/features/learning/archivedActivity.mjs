import { isStudyBlock } from '../planner/blockKind.mjs';

export function archivedActivityReferences(blocks, activityId) {
  return blocks.filter(block => isStudyBlock(block) && block.activityId === activityId);
}

export function missingActivitySnapshot(block, activity) {
  const patch = {};
  if (!block.activityName && activity.name) patch.activityName = activity.name;
  if (!block.activityColor && activity.color) patch.activityColor = activity.color;
  return patch;
}
