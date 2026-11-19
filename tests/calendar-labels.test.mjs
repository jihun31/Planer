import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarLabelPlacements} from '../src/features/planner/calendarLabels.mjs';

const at = groups => minute => groups.find(group => minute >= group.startMin && minute < group.endMin) || null;

test('one label per run on its widest row piece, spanning that piece', () => {
  const run = {startMin:40,endMin:100};
  const [label] = calendarLabelPlacements([0,60],at([run]));
  assert.equal(label.group,run);
  assert.equal(label.width,40);
  assert.deepEqual(label.style,{gridRow:'3 / 4',gridColumn:'2 / 42'});
  assert.equal(calendarLabelPlacements([0,60],at([run])).length,1);
});

test('equal-width pieces prefer the one closest to the run middle; plan minutes also work', () => {
  // Same group shown in two equal pieces of one row: the piece nearer the middle (50) wins.
  const group = {startMin:0,endMin:100};
  const pieces = minute => (minute >= 10 && minute < 20) || (minute >= 45 && minute < 55) ? group : null;
  assert.equal(calendarLabelPlacements([0],pieces)[0].key,45);
  const plan = {startMinute:30,endMinute:90};
  const placements = calendarLabelPlacements([0,60],minute => minute >= 30 && minute < 90 ? plan : null);
  assert.equal(placements.length,1);
  assert.equal(placements[0].key,30,'Equal distance keeps the first piece');
});

test('skipped minutes and separate runs get their own labels', () => {
  const runs = [{startMin:0,endMin:10},{startMin:20,endMin:30}];
  const placements = calendarLabelPlacements([0],at(runs));
  assert.deepEqual(placements.map(item => item.style.gridColumn),['2 / 12','22 / 32']);
  assert.deepEqual(calendarLabelPlacements([0],() => null),[]);
});
