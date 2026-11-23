import test from 'node:test';
import assert from 'node:assert/strict';
import { flowRestMinutes, isBreakNudgeMinutes, breakNudgeText } from '../src/features/planner/flowtime.mjs';

const min = 60_000;

test('flow rest is 20% of worked time, clamped to 5-20 minutes', () => {
  assert.equal(flowRestMinutes(4 * min + 59_000), null);
  assert.equal(flowRestMinutes(5 * min), 5);
  assert.equal(flowRestMinutes(27 * min), 5);
  assert.equal(flowRestMinutes(28 * min), 6);
  assert.equal(flowRestMinutes(37 * min), 7);
  assert.equal(flowRestMinutes(38 * min), 8);
  assert.equal(flowRestMinutes(50 * min), 10);
  assert.equal(flowRestMinutes(75 * min), 15);
  assert.equal(flowRestMinutes(100 * min), 20);
  assert.equal(flowRestMinutes(300 * min), 20);
  assert.equal(flowRestMinutes(NaN), null);
  assert.equal(flowRestMinutes(-1), null);
});

test('break nudge options and text', () => {
  assert.ok(isBreakNudgeMinutes(50));
  assert.ok(isBreakNudgeMinutes(7));
  assert.ok(isBreakNudgeMinutes(1));
  assert.ok(isBreakNudgeMinutes(240));
  assert.ok(!isBreakNudgeMinutes(0));
  assert.ok(!isBreakNudgeMinutes(241));
  assert.ok(!isBreakNudgeMinutes(12.5));
  assert.ok(!isBreakNudgeMinutes(NaN));
  assert.ok(!isBreakNudgeMinutes('50'));
  assert.equal(breakNudgeText(45), '45분 지났어요 · 쉬어 갈까요?');
});
