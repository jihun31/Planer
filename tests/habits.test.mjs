import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, dayKey, dueToday, isDay, isDue, normalizeHabit, scheduleLabel, startSuggestions,
  streakOf, totalDone, weekCells, weekDoneCount, weekStart, weeklyTarget,
} from '../src/features/habits/habitCore.mjs';

// 2026-11-16은 월요일, 2026-11-20은 금요일
const habit = (schedule, logs = {}, startDate = '2026-10-01') => ({ id: 'h', name: '운동', schedule, startDate, logs });
const logsOn = (days, value = 'full') => Object.fromEntries(days.map(day => [day, value]));

test('date helpers and the 05:00 day boundary', () => {
  assert.equal(dayKey(new Date(2026, 10, 20, 4, 59)), '2026-11-19');
  assert.equal(dayKey(new Date(2026, 10, 20, 5, 0)), '2026-11-20');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekStart('2026-11-20'), '2026-11-16');
  assert.equal(weekStart('2026-11-22'), '2026-11-16'); // 일요일은 그 주의 마지막 날
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
  assert.ok(isDay('2026-02-28'));
  assert.ok(!isDay('2026-02-30'));
  assert.ok(!isDay('20261120'));
});

test('start suggestions point at today, the next Monday and the first of next month', () => {
  assert.deepEqual(startSuggestions('2026-11-20').map(s => s.day), ['2026-11-20', '2026-11-23', '2026-12-01']);
  const monday = startSuggestions('2026-11-16');
  assert.equal(monday[1].day, '2026-11-16');
  assert.equal(startSuggestions('2026-12-15')[2].day, '2027-01-01');
});

test('due days follow the schedule and the start date', () => {
  assert.ok(isDue(habit({ type: 'daily' }), '2026-11-20'));
  assert.ok(!isDue(habit({ type: 'daily' }, {}, '2026-11-21'), '2026-11-20'));
  const mwf = habit({ type: 'weekdays', days: [1, 3, 5] });
  assert.ok(isDue(mwf, '2026-11-20')); // 금
  assert.ok(!isDue(mwf, '2026-11-19')); // 목
  assert.equal(scheduleLabel(mwf.schedule), '월·수·금');
  assert.equal(scheduleLabel({ type: 'weekly', count: 3 }), '주 3회');
  assert.equal(scheduleLabel({ type: 'weekdays', days: [0, 1] }), '월·일');
});

test('daily streak: today is pending, one miss is bridged, two misses in a row break it', () => {
  const today = '2026-11-20';
  // 17·18·19 연속 → 3, 오늘은 아직 안 해도 끊기지 않음
  assert.deepEqual(streakOf(habit({ type: 'daily' }, logsOn(['2026-11-17', '2026-11-18', '2026-11-19'])), today),
    { count: 3, unit: '일', missedLast: false, broken: true });
  // 오늘까지 하면 4
  assert.equal(streakOf(habit({ type: 'daily' }, logsOn(['2026-11-17', '2026-11-18', '2026-11-19', today])), today).count, 4);
  // 어제(19) 빠짐: 이어지지만 경고
  const oneMiss = streakOf(habit({ type: 'daily' }, logsOn(['2026-11-16', '2026-11-17', '2026-11-18'])), today);
  assert.equal(oneMiss.count, 3);
  assert.equal(oneMiss.missedLast, true);
  // 18·19 연속으로 빠짐: 끊김. 오늘 하면 1부터 다시
  assert.equal(streakOf(habit({ type: 'daily' }, logsOn(['2026-11-15', '2026-11-16', '2026-11-17'])), today).count, 0);
  assert.equal(streakOf(habit({ type: 'daily' }, logsOn(['2026-11-16', '2026-11-17', today])), today).count, 1);
  // 하나씩 걸러 빠지면 계속 이어짐
  assert.equal(streakOf(habit({ type: 'daily' }, logsOn(['2026-11-14', '2026-11-16', '2026-11-18'])), today).count, 3);
});

test('a tiny version counts as done', () => {
  const h = habit({ type: 'daily' }, { ...logsOn(['2026-11-18']), '2026-11-19': 'tiny' });
  assert.equal(streakOf(h, '2026-11-20').count, 2);
  assert.equal(totalDone(h), 2);
  assert.equal(totalDone(habit({ type: 'daily' }, { '2026-11-19': 'bogus' })), 0);
});

test('weekday streaks only look at the chosen days', () => {
  // 월·수·금: 9(월) 11(수) 13(금) 16(월) 18(수). 화·목·토·일은 안 해도 상관없음
  const h = habit({ type: 'weekdays', days: [1, 3, 5] }, logsOn(['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-16', '2026-11-18']));
  assert.equal(streakOf(h, '2026-11-20').count, 5);
  assert.equal(streakOf(h, '2026-11-20').missedLast, false);
  // 16(월)·18(수)을 연속으로 빠지면 끊김
  const broken = habit({ type: 'weekdays', days: [1, 3, 5] }, logsOn(['2026-11-09', '2026-11-11', '2026-11-13']));
  assert.equal(streakOf(broken, '2026-11-20').count, 0);
});

test('weekly streaks count weeks that met the target, with the same one-miss allowance', () => {
  const today = '2026-11-20';
  const w = (logs, startDate) => habit({ type: 'weekly', count: 2 }, logsOn(logs), startDate);
  // 11/2주, 11/9주 각각 2회 → 2주. 이번 주는 진행 중
  assert.deepEqual(streakOf(w(['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-12']), today),
    { count: 2, unit: '주', missedLast: false, broken: true });
  // 지난주 1회만(미달) → 이어지지만 경고
  const short = streakOf(w(['2026-11-02', '2026-11-04', '2026-11-09']), today);
  assert.equal(short.count, 1);
  assert.equal(short.missedLast, true);
  // 이번 주 이미 2회 → 포함
  assert.equal(streakOf(w(['2026-11-09', '2026-11-12', '2026-11-16', '2026-11-17']), today).count, 2);
  // 시작한 주는 남은 날만큼만 요구: 토요일 시작이면 그 주 목표 2회(토·일)
  const lateStart = habit({ type: 'weekly', count: 3 }, {}, '2026-11-14');
  assert.equal(weeklyTarget(lateStart, '2026-11-09'), 2);
  assert.equal(weeklyTarget(lateStart, '2026-11-16'), 3);
  assert.equal(weeklyTarget(lateStart, '2026-11-02'), 0);
  assert.equal(streakOf({ ...lateStart, logs: logsOn(['2026-11-14', '2026-11-15']) }, today).count, 1);
  assert.equal(weekDoneCount(w(['2026-11-15', '2026-11-16', '2026-11-20']), today), 2);
});

test('nothing counts before the start date', () => {
  assert.deepEqual(streakOf(habit({ type: 'daily' }, {}, '2026-11-23'), '2026-11-20'),
    { count: 0, unit: '일', missedLast: false, broken: false });
  // 어제 시작, 어제 안 함: 한 번 빠진 것뿐
  const s = streakOf(habit({ type: 'daily' }, {}, '2026-11-19'), '2026-11-20');
  assert.equal(s.count, 0);
  assert.equal(s.missedLast, true);
});

test('week cells show what happened on each day from Monday to Sunday', () => {
  const today = '2026-11-20';
  const daily = habit({ type: 'daily' }, { '2026-11-16': 'full', '2026-11-18': 'tiny' }, '2026-11-17');
  // 16일은 시작 전이라 기록이 있어도 '시작 전'
  assert.deepEqual(weekCells(daily, today).map(c => c.state), ['before', 'missed', 'tiny', 'missed', 'open', 'future', 'future']);
  assert.deepEqual(weekCells(daily, today).map(c => c.editable), [false, true, true, true, true, false, false]);
  const mwf = habit({ type: 'weekdays', days: [1, 3, 5] }, { '2026-11-16': 'full' });
  assert.deepEqual(weekCells(mwf, today).map(c => c.state), ['full', 'off', 'missed', 'off', 'open', 'off', 'off']);
  // 주 N회는 지난 날도 '빠짐'이 아니라 남은 기회로 본다
  const weekly = habit({ type: 'weekly', count: 3 }, { '2026-11-17': 'full' });
  assert.deepEqual(weekCells(weekly, today).map(c => c.state), ['open', 'full', 'open', 'open', 'open', 'future', 'future']);
});

test("today's list shows what is due, unfinished weekly targets, and what is already done", () => {
  const today = '2026-11-20';
  const list = [
    { ...habit({ type: 'daily' }), id: 'daily' },
    { ...habit({ type: 'weekdays', days: [1] }), id: 'monday-only' },
    { ...habit({ type: 'weekdays', days: [1] }, logsOn([today])), id: 'monday-only-done' },
    { ...habit({ type: 'weekly', count: 2 }, logsOn(['2026-11-16', '2026-11-17'])), id: 'weekly-met' },
    { ...habit({ type: 'weekly', count: 2 }, logsOn(['2026-11-16'])), id: 'weekly-open' },
    { ...habit({ type: 'daily' }), id: 'archived', archived: true },
    { ...habit({ type: 'daily' }, {}, '2026-11-23'), id: 'later' },
  ];
  assert.deepEqual(dueToday(list, today).map(h => h.id), ['daily', 'monday-only-done', 'weekly-open']);
});

test('normalizeHabit trims input, checks every field and keeps only known schedule fields', () => {
  const base = { name: ' 운동 ', emoji: '🏃', anchor: ' 아침 커피를 마시고 ', tinyVersion: '운동복 입기', startDate: '2026-11-23' };
  assert.deepEqual(normalizeHabit({ ...base, schedule: { type: 'weekly', count: '3', days: [1] } }).value,
    { name: '운동', emoji: '🏃', anchor: '아침 커피를 마시고', tinyVersion: '운동복 입기', schedule: { type: 'weekly', count: 3 }, startDate: '2026-11-23' });
  assert.deepEqual(normalizeHabit({ ...base, schedule: { type: 'weekdays', days: [5, 1, 1, 9] } }).value.schedule, { type: 'weekdays', days: [1, 5] });
  assert.deepEqual(normalizeHabit({ ...base, schedule: { type: 'daily', count: 3 } }).value.schedule, { type: 'daily' });
  assert.match(normalizeHabit({ ...base, name: '  ', schedule: { type: 'daily' } }).error, /이름/);
  assert.match(normalizeHabit({ ...base, schedule: { type: 'weekly', count: 8 } }).error, /1~7/);
  assert.match(normalizeHabit({ ...base, schedule: { type: 'weekdays', days: [] } }).error, /요일/);
  assert.match(normalizeHabit({ ...base, schedule: { type: 'hourly' } }).error, /주기/);
  assert.match(normalizeHabit({ ...base, startDate: '2026-02-30', schedule: { type: 'daily' } }).error, /시작일/);
  assert.match(normalizeHabit({ ...base, anchor: 'a'.repeat(81), schedule: { type: 'daily' } }).error, /80자/);
});
