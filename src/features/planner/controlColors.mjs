export const CONTROL_GROUP_COLORS = Object.freeze({
  controlled: '#2563eb',
  foolish: '#dc2626',
});

export const controlColor = group => CONTROL_GROUP_COLORS[group] || CONTROL_GROUP_COLORS.controlled;

// Keep each group's saved order while always placing controlled activities first.
export function orderControlActivities(activities) {
  return [
    ...activities.filter(activity => activity.group !== 'foolish'),
    ...activities.filter(activity => activity.group === 'foolish'),
  ];
}

export function colorizeControlBlocks(blocks, activities) {
  const groupById = new Map(activities.map(activity => [activity.id, activity.group]));
  return blocks.map(block => {
    const color = controlColor(block.group || groupById.get(block.activityId));
    return { ...block, activityColor: color, customColor: color };
  });
}
