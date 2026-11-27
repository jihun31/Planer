import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertDateDue, alertMessage, alertMoment, dueTodayPlans, parseAlertTime } from '../src/features/tonkatsu/checkInAlert.mjs';

const kst = (iso) => Date.parse(`${iso}+09:00`);
const view = (plans, extra = {}) => ({ rest_history: [], exemptions: [], ...plans, ...extra });
const plan = (content, more = {}) => ({ content, history: [], created_at: '2026-11-01', ...more });

test('alert time parsing', () => {
  assert.deepEqual(parseAlertTime('00:30'), { hour: 0, minute: 30 });
  for (const bad of ['24:00', '7:30', '12:60', '', null, 'off']) assert.equal(parseAlertTime(bad), null, String(bad));
});

test('times before 05:00 belong to that night (next calendar day)', () => {
  assert.equal(alertMoment('2026-11-27', '00:30'), kst('2026-11-28T00:30:00'));
  assert.equal(alertMoment('2026-11-27', '22:00'), kst('2026-11-27T22:00:00'));
  assert.equal(alertMoment('2026-11-27', '04:59'), kst('2026-11-28T04:59:00'));
});

test('alert fires once per day after the time, until the 05:00 day boundary', () => {
  assert.equal(alertDateDue('00:30', null, kst('2026-11-27T23:59:00')), null);
  assert.equal(alertDateDue('00:30', null, kst('2026-11-28T00:30:00')), '2026-11-27');
  assert.equal(alertDateDue('00:30', null, kst('2026-11-28T03:00:00')), '2026-11-27'); // 늦게 켜도 정산 전이면 보냄
  assert.equal(alertDateDue('00:30', '2026-11-27', kst('2026-11-28T00:31:00')), null);
  assert.equal(alertDateDue('00:30', '2026-11-27', kst('2026-11-28T05:00:00')), null); // 새 날은 아직 시각 전
  assert.equal(alertDateDue(null, null, kst('2026-11-28T01:00:00')), null);
});

test('only plans that would be fined tonight count', () => {
  const sunday = '2026-11-29', friday = '2026-11-27';
  const v = view({
    Daily: [plan('물 마시기'), plan('운동', { history: [friday] }), plan('새 계획', { created_at: '2026-11-28' })],
    Routine: [plan('영어', { days: ['금'] }), plan('수영', { days: ['월'] })],
    Weekly: [plan('독서', { count: 2, history: ['2026-11-23'] })],
    Monthly: [plan('정리', { count: 1 })],
    Interval: [plan('청소', { interval: 1 })],
    Limit: [plan('게임', { period: 'day', limit: 1 })],
    OneTime: [plan('보고서', { deadline: friday }), plan('발표', { deadline: '2026-11-30' })],
  });
  const names = (date, target = v) => dueTodayPlans(target, date).map(([, p]) => p.content);
  assert.deepEqual(names(friday), ['물 마시기', '영어', '보고서']);
  assert.deepEqual(names(sunday), ['물 마시기', '운동', '새 계획', '독서']); // 주간은 일요일에 모자랄 때만
  assert.deepEqual(names('2026-11-30'), ['물 마시기', '운동', '새 계획', '수영', '정리', '발표']); // 월간은 말일에만
  assert.deepEqual(names(friday, { ...v, rest_history: [friday] }), []);
  assert.deepEqual(names(friday, { ...v, exemptions: [friday] }), []);
});

test('weekly plans started mid-week are not counted that week', () => {
  const v = view({ Weekly: [plan('독서', { count: 1, created_at: '2026-11-25' })] });
  assert.deepEqual(dueTodayPlans(v, '2026-11-29'), []);
});

test('message lists remaining plans and caps long lists', () => {
  const due = ['a', 'b', 'c', 'd', 'e', 'f'].map((c) => ['Daily', { content: c }]);
  assert.deepEqual(alertMessage(due.slice(0, 1)), { title: '돈까스 인증 1개가 남았어요', body: '[일일] a' });
  assert.equal(alertMessage(due).body, '[일일] a\n[일일] b\n[일일] c\n[일일] d\n외 2개');
});
