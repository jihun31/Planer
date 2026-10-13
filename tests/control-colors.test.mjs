import test from 'node:test';
import assert from 'node:assert/strict';
import { controlColor, colorizeControlBlocks, orderControlActivities } from '../src/features/planner/controlColors.mjs';

test('control groups use one blue and one red across registered and custom records', () => {
  assert.equal(controlColor('controlled'), '#2563eb');
  assert.equal(controlColor('foolish'), '#dc2626');
  const activities = [{ id: 'a', group: 'foolish' }];
  const blocks = colorizeControlBlocks([
    { activityId: 'a', group: 'controlled', activityColor: '#00ff00' },
    { activityId: 'a', activityColor: '#00ff00' },
    { customName: '쇼츠', group: 'foolish', customColor: '#00ff00' },
  ], activities);
  assert.deepEqual(blocks.map(block => block.activityColor), ['#2563eb', '#dc2626', '#dc2626']);
  assert.equal(blocks[0].group, 'controlled');
});

test('controlled activities stay left, and newly added controlled activities follow their group', () => {
  const activities = [
    { id: 'blue-1', group: 'controlled' },
    { id: 'red-1', group: 'foolish' },
    { id: 'red-2', group: 'foolish' },
    { id: 'blue-new', group: 'controlled' },
  ];
  assert.deepEqual(orderControlActivities(activities).map(activity => activity.id),
    ['blue-1', 'blue-new', 'red-1', 'red-2']);
});
