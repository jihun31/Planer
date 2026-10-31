import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { baseDate, buildViews, checkInTag, iterPlans, monthlyTarget, progressLine, weeklyTarget, addDays, weekday, lastDayOfMonth } from '../src/features/tonkatsu/tonkatsuCore.mjs';

// bot/tests/test_parity.py가 bot/core.py로 만든 기준 결과
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/tonkatsu-parity.json', import.meta.url), 'utf8'));

test('app rules give exactly the same results as the bot (bot/core.py)', () => {
  const { view, results } = fixture;
  let i = 0;
  for (const date of [...new Set(results.map((r) => r.date))]) {
    for (const [category, plan] of iterPlans(view)) {
      const expected = results[i++];
      assert.equal(expected.content, plan.content);
      assert.deepEqual(progressLine(view, category, plan, date), expected.progress, `${date} ${plan.content} progress`);
      assert.equal(checkInTag(view, category, plan, date), expected.tag, `${date} ${plan.content} tag`);
      if (category === 'Weekly') assert.equal(weeklyTarget(view, plan, date), expected.target);
      if (category === 'Monthly') assert.equal(monthlyTarget(view, plan, date), expected.target);
    }
  }
  assert.equal(i, results.length);
});

test('day boundary is 05:00 KST regardless of PC time zone', () => {
  for (const { ms, date } of fixture.baseDates) assert.equal(baseDate(ms), date, String(ms));
});

test('date helpers', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(weekday('2026-11-02'), 0); // 월요일
  assert.equal(weekday('2026-11-08'), 6);
  assert.equal(lastDayOfMonth('2028-02-10'), 29);
});

test('buildViews groups Firestore docs like the bot', () => {
  const views = buildViews({
    members: [{ id: '1', displayName: '앨리스', fines: 6000, alertHour: 23 }],
    plans: [
      { id: 'p1', ownerId: '1', category: 'Daily', content: '운동', startDate: '2026-10-01', status: 'active' },
      { id: 'p2', ownerId: '1', category: 'OneTime', content: '접수', deadline: '2026-11-20', startDate: '2026-10-01', status: 'completed', completedAt: '2026-11-02' },
      { id: 'p3', ownerId: '1', category: 'Daily', content: '삭제', startDate: '2026-10-01', status: 'deleted' },
      { id: 'p4', ownerId: '2', category: 'Limit', content: '몬스터', period: 'week', limit: 2, startDate: '2026-10-01', status: 'active' },
    ],
    checkIns: [{ planId: 'p1', date: '2026-11-03' }, { planId: 'p1', date: '2026-11-02' }, { planId: 'p4', date: '2026-11-02' }, { planId: 'p4', date: '2026-11-02' }],
    offDays: [{ ownerId: '1', type: 'rest', date: '2026-11-05' }, { ownerId: '1', type: 'exempt', date: '2026-11-04' }],
  });
  assert.deepEqual(views['1'].Daily.map((p) => [p.id, p.history]), [['p1', ['2026-11-02', '2026-11-03']]]);
  assert.equal(views['1'].completed_goals[0].completed_at, '2026-11-02');
  assert.deepEqual([views['1'].rest_history, views['1'].exemptions, views['1'].fines, views['1'].alert_time], [['2026-11-05'], ['2026-11-04'], 6000, 23]);
  assert.equal(views['2'].Limit[0].history.length, 2);
  assert.equal(views['2'].display_name, undefined); // 멤버 문서 없음
});

test('plan edit helpers: allowed fields, validation, normalization', async () => {
  const W = await import('../src/features/tonkatsu/tonkatsuWrites.mjs');
  assert.deepEqual(W.editableKeys('Daily'), ['content', 'photo']);
  assert.deepEqual(W.editableKeys('Weekly'), ['content', 'photo', 'count']);
  assert.deepEqual(W.editableKeys('Limit'), ['content', 'limit']); // 제한 기간·사진은 못 바꿈
  const weekly = { id: 'p', category: 'Weekly', content: '코딩', count: 3, photo: true };
  assert.equal(W.planEditError(weekly, { photo: false }), null);
  assert.equal(W.planEditError(weekly, { count: 8 }), '주간 목표는 1~7회로 정해 주세요.');
  assert.equal(W.planEditError({ id: 'l', category: 'Limit', content: '몬스터', period: 'week', limit: 2 }, { limit: 0 }), null);
  assert.deepEqual(W.planEditUpdate(weekly, { content: ' 코딩2 ', photo: 0, category: 'Daily', ownerId: 'x' }, 'TS'),
    { updatedAt: 'TS', content: '코딩2', photo: false });
  assert.deepEqual(W.planEditUpdate({ category: 'Routine' }, { days: ['금', '월'] }, 'TS'), { updatedAt: 'TS', days: ['월', '금'] });
  assert.deepEqual(W.planEditUpdate({ category: 'Limit' }, { photo: true, period: 'day', limit: 1 }, 'TS'), { updatedAt: 'TS', limit: 1 });
});
