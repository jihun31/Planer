import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  completion, countLabel, countOf, historyWeeks, isValidLog, nextCellValue, statusOf, stepCount, weekReview,
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
    { name: '운동', emoji: '🏃', anchor: '아침 커피를 마시고', tinyVersion: '운동복 입기', schedule: { type: 'weekly', count: 3 }, target: { type: 'check' }, startDate: '2026-11-23' });
  const count = normalizeHabit({ ...base, schedule: { type: 'daily' }, target: { type: 'count', value: '8', unit: ' 잔 ' } }).value;
  assert.deepEqual(count.target, { type: 'count', value: 8, unit: '잔' });
  assert.equal(count.tinyVersion, ''); // 횟수 습관은 1회 이상이면 최소
  assert.match(normalizeHabit({ ...base, schedule: { type: 'daily' }, target: { type: 'count', value: 1 } }).error, /2~99/);
  assert.match(normalizeHabit({ ...base, schedule: { type: 'daily' }, target: { type: 'count', value: 8, unit: '아주긴단위이름' } }).error, /단위/);
  assert.deepEqual(normalizeHabit({ ...base, schedule: { type: 'weekdays', days: [5, 1, 1, 9] } }).value.schedule, { type: 'weekdays', days: [1, 5] });
  assert.deepEqual(normalizeHabit({ ...base, schedule: { type: 'daily', count: 3 } }).value.schedule, { type: 'daily' });
  assert.match(normalizeHabit({ ...base, name: '  ', schedule: { type: 'daily' } }).error, /이름/);
  assert.match(normalizeHabit({ ...base, schedule: { type: 'weekly', count: 8 } }).error, /1~7/);
  assert.match(normalizeHabit({ ...base, schedule: { type: 'weekdays', days: [] } }).error, /요일/);
  assert.match(normalizeHabit({ ...base, schedule: { type: 'hourly' } }).error, /주기/);
  assert.match(normalizeHabit({ ...base, startDate: '2026-02-30', schedule: { type: 'daily' } }).error, /시작일/);
  assert.match(normalizeHabit({ ...base, anchor: 'a'.repeat(81), schedule: { type: 'daily' } }).error, /80자/);
});

test('skip days are neither done nor missed, with no limit', () => {
  const today = '2026-11-20';
  // 18·19 쉬는 날: 17에서 이어짐(빠진 날 없음)
  const daily = habit({ type: 'daily' }, { ...logsOn(['2026-11-16', '2026-11-17']), '2026-11-18': 'skip', '2026-11-19': 'skip' });
  assert.equal(streakOf(daily, today).count, 2);
  assert.equal(streakOf(daily, today).missedLast, false);
  assert.equal(totalDone(daily), 2);
  assert.deepEqual(weekCells(daily, today).map(c => c.state).slice(0, 5), ['full', 'full', 'skip', 'skip', 'open']);
  // 쉬는 날을 길게 이어 붙여도 끊기지 않는다
  const rest = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [addDays('2026-11-02', i), 'skip']));
  assert.equal(streakOf(habit({ type: 'daily' }, { '2026-11-01': 'full', ...rest }), today).count, 1);
  // 주 N회: 쉬는 날만큼 그 주 목표가 줄고, 한 주를 다 쉬면 그 주는 건너뜀
  const wholeWeek = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [addDays('2026-11-09', i), 'skip']));
  const weekly = habit({ type: 'weekly', count: 3 }, { ...logsOn(['2026-11-02', '2026-11-03', '2026-11-04']), ...wholeWeek });
  assert.equal(weeklyTarget(weekly, '2026-11-09'), 0);
  assert.equal(streakOf(weekly, today).count, 1);
  assert.equal(streakOf(weekly, today).missedLast, false);
  const fiveSkips = Object.fromEntries(['10', '11', '12', '13', '14'].map(d => [`2026-11-${d}`, 'skip']));
  assert.equal(weeklyTarget(habit({ type: 'weekly', count: 3 }, fiveSkips), '2026-11-09'), 2);
  // 오늘 쉬는 날이면 오늘 목록에 남아 상태를 보여 줌
  assert.equal(dueToday([habit({ type: 'weekdays', days: [1] }, { [today]: 'skip' })], today).length, 1);
});

test('count habits: partial counts are tiny, reaching the target is full', () => {
  const today = '2026-11-20';
  const water = { ...habit({ type: 'daily' }, { '2026-11-18': 8, '2026-11-19': 3, [today]: 10 }), target: { type: 'count', value: 8, unit: '잔' } };
  assert.equal(statusOf(water, '2026-11-18'), 'full');
  assert.equal(statusOf(water, '2026-11-19'), 'tiny');
  assert.equal(statusOf(water, today), 'full');
  assert.equal(statusOf(water, '2026-11-17'), null);
  assert.equal(countOf(water, '2026-11-19'), 3);
  assert.equal(countLabel(water, 3), '3/8잔');
  assert.equal(streakOf(water, today).count, 3);
  assert.equal(stepCount(water, '2026-11-19', 1), 4);
  assert.equal(stepCount(water, '2026-11-17', -1), null);
  assert.equal(stepCount({ ...water, logs: { [today]: 1 } }, today, -1), null);
  assert.equal(stepCount({ ...water, logs: { [today]: 999 } }, today, 1), 999);
  // 숫자 기록이 있는 일반 습관은 완료로 본다
  assert.equal(statusOf(habit({ type: 'daily' }, { [today]: 2 }), today), 'full');
  assert.ok(isValidLog(5) && isValidLog('skip') && isValidLog(null));
  assert.ok(!isValidLog(0) && !isValidLog(1.5) && !isValidLog('done') && !isValidLog(1000));
});

test('cell cycle: empty → done → tiny (if any) → skip → empty', () => {
  const day = '2026-11-19';
  const withTiny = { ...habit({ type: 'daily' }), tinyVersion: '한 모금' };
  const values = [];
  let logs = {};
  for (let i = 0; i < 4; i += 1) {
    const value = nextCellValue({ ...withTiny, logs }, day);
    values.push(value);
    logs = value === null ? {} : { [day]: value };
  }
  assert.deepEqual(values, ['full', 'tiny', 'skip', null]);
  assert.equal(nextCellValue(habit({ type: 'daily' }, { [day]: 'full' }), day), 'skip');
  const count = { ...habit({ type: 'daily' }), target: { type: 'count', value: 8 } };
  assert.equal(nextCellValue(count, day), 8);
  assert.equal(nextCellValue({ ...count, logs: { [day]: 8 } }, day), 'skip');
  assert.equal(nextCellValue({ ...count, logs: { [day]: 3 } }, day), 'skip');
});

test('completion rate leaves out rest days and does not punish an unfinished today', () => {
  const today = '2026-11-20';
  const daily = habit({ type: 'daily' }, { ...logsOn(['2026-11-16', '2026-11-17']), '2026-11-18': 'skip' });
  // 16·17 완료, 18 쉬는 날, 19 빠짐, 20(오늘) 아직 → 2/3
  assert.deepEqual(completion(daily, '2026-11-16', '2026-11-22', today), { done: 2, total: 3, rate: 2 / 3 });
  assert.equal(completion({ ...daily, logs: { ...daily.logs, [today]: 'full' } }, '2026-11-16', '2026-11-22', today).total, 4);
  assert.equal(completion(daily, '2026-12-01', '2026-12-07', today).rate, null);
  // 주 N회: 주마다 목표까지만 인정
  const weekly = habit({ type: 'weekly', count: 2 }, logsOn(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-02']));
  assert.deepEqual(completion(weekly, '2026-11-02', '2026-11-15', today), { done: 3, total: 4, rate: 0.75 });
});

test('week review compares last week with the week before', () => {
  const today = '2026-11-20'; // 지난주 11/9~11/15, 그 전 주 11/2~11/8
  const a = { ...habit({ type: 'daily' }, logsOn(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-02'])), id: 'a' };
  const b = { ...habit({ type: 'weekly', count: 2 }, logsOn(['2026-11-10', '2026-11-03', '2026-11-04'])), id: 'b' };
  const later = { ...habit({ type: 'daily' }, {}, '2026-11-16'), id: 'later' };
  const review = weekReview([a, b, later, { ...a, id: 'gone', archived: true }], today);
  assert.equal(review.from, '2026-11-09');
  assert.equal(review.to, '2026-11-15');
  assert.deepEqual(review.items.map(i => [i.habit.id, i.done, i.total]), [['a', 6, 7], ['b', 1, 2]]);
  assert.equal(review.items[0].prevRate, 1 / 7);
  assert.equal(review.items[1].prevRate, 1);
  assert.equal(review.rate, 7 / 9);
});

test('history weeks cover the last 26 weeks ending this week', () => {
  const today = '2026-11-20';
  const h = habit({ type: 'daily' }, { '2026-11-19': 'full', '2026-11-18': 'skip' }, '2026-11-01');
  const weeks = historyWeeks(h, today);
  assert.equal(weeks.length, 26);
  assert.equal(weeks.at(-1).monday, '2026-11-16');
  assert.equal(weeks[0].monday, addDays('2026-11-16', -7 * 25));
  assert.deepEqual(weeks.at(-1).days.map(d => d.state), ['missed', 'missed', 'skip', 'full', 'open', 'future', 'future']);
  assert.equal(weeks[0].days[0].state, 'before');
  const weekly = habit({ type: 'weekly', count: 2 }, { '2026-11-10': 'full' });
  assert.equal(historyWeeks(weekly, today, 2)[0].days[0].state, 'empty');
});

test('badges follow the running total, so a broken streak keeps its progress', async () => {
  const { badgesOf, crossedBadge } = await import('../src/features/habits/habitCore.mjs');
  const days = n => logsOn(Array.from({ length: n }, (_, i) => addDays('2026-10-01', i * 2)));
  assert.deepEqual(badgesOf(habit({ type: 'daily' })).next, { count: 7, tier: 'bronze', label: '첫 일주일', remaining: 7 });
  const six = habit({ type: 'daily' }, days(6));
  assert.equal(badgesOf(six).earned.length, 0);
  const seven = habit({ type: 'daily' }, { ...days(6), '2026-11-20': 'tiny' });
  assert.deepEqual(badgesOf(seven).earned.map(b => b.tier), ['bronze']);
  assert.equal(badgesOf(seven).next.remaining, 23);
  assert.equal(crossedBadge(six, seven).tier, 'bronze');
  assert.equal(crossedBadge(seven, six), null); // 취소는 배지를 주지 않음
  assert.equal(crossedBadge(seven, seven), null);
  // 쉬는 날은 세지 않음
  assert.equal(badgesOf(habit({ type: 'daily' }, { ...days(6), '2026-11-20': 'skip' })).earned.length, 0);
  const all = habit({ type: 'daily' }, logsOn(Array.from({ length: 120 }, (_, i) => addDays('2026-07-01', i))), '2026-07-01');
  assert.deepEqual(badgesOf(all).earned.map(b => b.count), [7, 30, 66, 100]);
  assert.equal(badgesOf(all).next, null);
});

test('automaticity self-check: asked weekly after a week and three repetitions; settled after two 4+ answers', async () => {
  const { automaticityDue, automaticityOf, isValidScore } = await import('../src/features/habits/habitCore.mjs');
  const today = '2026-11-20';
  const base = habit({ type: 'daily' }, logsOn(['2026-11-10', '2026-11-11', '2026-11-12']), '2026-11-09');
  assert.ok(automaticityDue(base, today));
  assert.ok(!automaticityDue({ ...base, startDate: '2026-11-14' }, today)); // 시작 일주일 전
  assert.ok(!automaticityDue({ ...base, logs: logsOn(['2026-11-10', '2026-11-11']) }, today)); // 2회뿐
  assert.ok(!automaticityDue({ ...base, automaticity: { '2026-11-16': 3 } }, today)); // 이번 주 답함
  assert.ok(automaticityDue({ ...base, automaticity: { '2026-11-09': 3 } }, today)); // 지난주 답은 이번 주와 별개
  assert.ok(!automaticityDue({ ...base, archived: true }, today));
  assert.deepEqual(automaticityOf(base), { history: [], latest: null, settled: false });
  const answered = automaticityOf({ automaticity: { '2026-11-16': 4, '2026-11-02': 2, '2026-11-09': 5, bad: 3, '2026-10-26': 9 } });
  assert.deepEqual(answered.history.map(h => h.score), [2, 5, 4]);
  assert.equal(answered.latest.week, '2026-11-16');
  assert.equal(answered.settled, true);
  assert.equal(automaticityOf({ automaticity: { '2026-11-09': 5, '2026-11-16': 3 } }).settled, false);
  assert.equal(automaticityOf({ automaticity: { '2026-11-16': 5 } }).settled, false); // 한 번만으론 부족
  assert.ok(isValidScore(1) && isValidScore(5) && !isValidScore(0) && !isValidScore(6) && !isValidScore(2.5));
});

test('date-of-month habits are due on the chosen dates and fall back to the last day of short months', () => {
  const h = habit({ type: 'monthdays', days: [1, 15, 31] });
  assert.ok(isDue(h, '2026-11-15'));
  assert.ok(isDue(h, '2026-12-01'));
  assert.ok(!isDue(h, '2026-11-16'));
  assert.ok(isDue(h, '2026-11-30'));  // 11월엔 31일이 없어 말일
  assert.ok(!isDue(h, '2026-12-30'));
  assert.ok(isDue(h, '2026-12-31'));
  assert.ok(isDue(habit({ type: 'monthdays', days: [30] }), '2027-02-28'));
  assert.equal(scheduleLabel(h.schedule), '매월 1·15·31일');
  // 날짜 단위 연속 기록: 1일·15일 완료 → 2일 연속, 오늘(20일)은 해야 하는 날이 아님
  const done = habit({ type: 'monthdays', days: [1, 15] }, logsOn(['2026-11-01', '2026-11-15']), '2026-11-01');
  assert.deepEqual(streakOf(done, '2026-11-20'), { count: 2, unit: '일', missedLast: false, broken: false });
  assert.equal(dueToday([done], '2026-11-20').length, 0);
  assert.equal(dueToday([done], '2026-12-01').length, 1);
  assert.deepEqual(normalizeHabit({ name: '정산', startDate: '2026-11-01', schedule: { type: 'monthdays', days: [15, 1, 1, 32, 0] } }).value.schedule,
    { type: 'monthdays', days: [1, 15] });
  assert.match(normalizeHabit({ name: '정산', startDate: '2026-11-01', schedule: { type: 'monthdays', days: [] } }).error, /날짜/);
});

test('monthly habits count completions per month, like weekly ones per week', async () => {
  const { monthlyTarget, monthDoneCount, periodProgress } = await import('../src/features/habits/habitCore.mjs');
  const today = '2026-11-20';
  const m = (logs, startDate) => habit({ type: 'monthly', count: 4 }, logsOn(logs), startDate);
  assert.equal(scheduleLabel({ type: 'monthly', count: 4 }), '월 4회');
  const h = m(['2026-11-02', '2026-11-09', '2026-10-01', '2026-10-05', '2026-10-10', '2026-10-20']);
  assert.equal(monthDoneCount(h, today), 2);
  assert.equal(monthlyTarget(h, '2026-11-01'), 4);
  assert.deepEqual(periodProgress(h, today), { label: '이번 달', done: 2, target: 4 });
  assert.deepEqual(periodProgress(habit({ type: 'weekly', count: 2 }, logsOn(['2026-11-17'])), today), { label: '이번 주', done: 1, target: 2 });
  assert.equal(periodProgress(habit({ type: 'daily' }), today), null);
  // 10월 달성(4회) + 이번 달 진행 중 → 1달 연속, 단위 '달'
  assert.deepEqual(streakOf(h, today), { count: 1, unit: '달', missedLast: false, broken: false });
  // 9·10월 둘 다 못 채우면 끊김
  assert.equal(streakOf(m(['2026-11-02'], '2026-09-01'), today).broken, true);
  // 시작한 달은 남은 날만큼만, 쉬는 날만큼 줄여서 요구
  assert.equal(monthlyTarget(m([], '2026-11-28'), '2026-11-01'), 3);
  const skips = Object.fromEntries(Array.from({ length: 28 }, (_, i) => [addDays('2026-11-01', i), 'skip']));
  assert.equal(monthlyTarget(habit({ type: 'monthly', count: 4 }, skips), '2026-11-01'), 2);
  // 목표가 남았으면 오늘 목록에, 다 채우면 빠짐
  assert.equal(dueToday([h], today).length, 1);
  assert.equal(dueToday([m(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'])], today).length, 0);
  // 지난달 빈 날은 'empty', 이번 달 남은 날은 'open'
  assert.deepEqual(weekCells(m([], '2026-10-01'), '2026-12-02').map(c => c.state).slice(0, 3), ['empty', 'open', 'open']);
  // 달성률: 10월 4/4 + 11월 진행 중 2회
  assert.deepEqual(completion(h, '2026-10-01', today, today), { done: 6, total: 6, rate: 1 });
  // 지난주 돌아보기에는 넣지 않음
  assert.equal(weekReview([h], today).items.length, 0);
  assert.match(normalizeHabit({ name: '독서', startDate: '2026-11-01', schedule: { type: 'monthly', count: 32 } }).error, /1~31/);
  assert.deepEqual(normalizeHabit({ name: '독서', startDate: '2026-11-01', schedule: { type: 'monthly', count: '10', days: [1] } }).value.schedule,
    { type: 'monthly', count: 10 });
});
