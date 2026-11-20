// 습관 규칙(순수 함수). 날짜는 'YYYY-MM-DD' 문자열, 하루는 새벽 5시에 바뀐다.
//
// 근거로 삼은 연구:
// - 하루 빠진 영향은 작고 길게 빠지면 크게 흔들린다(Lally 외 2010) → 해야 하는 날을 한 번 빠져도 연속 기록은
//   이어지고, 두 번 연속 빠지면 끊긴다.
// - 아주 작은 행동부터 시작한다(Fogg, Tiny Habits) → 최소 버전('tiny')만 해도 그날은 한 것으로 센다.
// - 고정 일정보다 유연한 일정이 더 오래 간다(Beshears 외 2021) → 기본 주기는 '주 N회'.
// - 기록을 돌아볼 때 효과가 커진다(Harkin 외 2016) → 지난주 돌아보기(weekReview).
//
// 기록 값(logs[day]): 'full' | 'tiny' | 'skip'(쉬는 날) | 숫자(횟수 목표 습관의 그날 횟수)
// 쉬는 날은 해야 하는 날에서 빠진다. 연속 기록에 들어가지도, 끊지도 않는다.

import { DAY_START_HOUR, plannerDate } from '../planner/scheduleTime.mjs';

export { DAY_START_HOUR };
export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
// 화면에 그리는 요일 순서(월요일 시작)
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
// 주기: daily(매일) · weekdays(요일 지정) · monthdays(날짜 지정, 매월 N일) · weekly(주 N회) · monthly(월 N회)
export const SCHEDULE_TYPES = ['daily', 'weekdays', 'monthdays', 'weekly', 'monthly'];
export const MONTH_DAY_MAX = 31;
export const TARGET_TYPES = ['check', 'count'];
export const LOG_VALUES = ['full', 'tiny', 'skip'];
export const DONE_STATES = ['full', 'tiny'];
export const NAME_MAX = 40;
export const TEXT_MAX = 80;
export const UNIT_MAX = 6;
export const COUNT_MAX = 99;
export const LOG_COUNT_MAX = 999;
export const HISTORY_WEEKS = 26;

const pad = n => String(n).padStart(2, '0');
export const formatDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = value => typeof value === 'string' && DAY_RE.test(value) && formatDay(parseDay(value)) === value;
// 정오로 잡아 서머타임 경계에서도 날짜가 밀리지 않게 한다.
export const parseDay = day => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (day, n) => { const d = parseDay(day); d.setDate(d.getDate() + n); return formatDay(d); };
export const weekdayOf = day => parseDay(day).getDay();
export const weekStart = day => addDays(day, -((weekdayOf(day) + 6) % 7));
export const shortDay = day => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
export const monthStart = day => `${day.slice(0, 8)}01`;
export const monthEnd = day => { const d = parseDay(day); return formatDay(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)); };
const dayOfMonth = day => Number(day.slice(8, 10));
const daysBetween = (from, to) => Math.round((parseDay(to) - parseDay(from)) / 86400000) + 1;

// 횟수로 채우는 주기(주 N회·월 N회)의 기간 계산. 기간은 첫날 문자열로 나타낸다.
const PERIODS = {
  weekly: { unit: '주', start: weekStart, end: first => addDays(first, 6), next: first => addDays(first, 7) },
  monthly: { unit: '달', start: monthStart, end: monthEnd, next: first => addDays(monthEnd(first), 1) },
};
const periodOf = habit => PERIODS[habit?.schedule?.type] ?? null;
export const isPeriodic = habit => Boolean(periodOf(habit));

// 시간 관리와 같은 하루 기준(새벽 5시)
export const dayKey = (now = new Date()) => plannerDate(now);

// 시작일 추천: 주·월의 시작은 새 출발 효과(Dai·Milkman·Riis 2014)가 있는 날이다.
export function startSuggestions(today) {
  const toMonday = (8 - weekdayOf(today)) % 7;
  const d = parseDay(today);
  const nextMonth = formatDay(new Date(d.getFullYear(), d.getMonth() + 1, 1, 12));
  return [
    { id: 'today', label: '오늘부터', day: today },
    { id: 'monday', label: toMonday === 0 ? '이번 월요일(오늘)' : '다음 월요일', day: addDays(today, toMonday) },
    { id: 'month', label: '다음 달 1일', day: nextMonth },
  ];
}

export const isCountHabit = habit => habit?.target?.type === 'count';
export const countTarget = habit => (isCountHabit(habit) ? habit.target.value : 1);
export const isValidLog = value => value === null || LOG_VALUES.includes(value)
  || (Number.isInteger(value) && value >= 1 && value <= LOG_COUNT_MAX);

// 그날 횟수(횟수 목표 습관). 다른 값이면 0.
export const countOf = (habit, day) => {
  const value = habit?.logs?.[day];
  return Number.isInteger(value) && value > 0 ? value : 0;
};

// 그날 상태: 'full' | 'tiny' | 'skip' | null. 횟수는 목표 이상이면 full, 1 이상이면 tiny.
export function statusOf(habit, day) {
  const value = habit?.logs?.[day];
  if (LOG_VALUES.includes(value)) return value;
  if (Number.isInteger(value) && value > 0) return value >= countTarget(habit) ? 'full' : 'tiny';
  return null;
}
export const isDone = (habit, day) => DONE_STATES.includes(statusOf(habit, day));
export const isSkipped = (habit, day) => statusOf(habit, day) === 'skip';

// 그날 해야 하는 날인지(쉬는 날 여부와는 별개). 주·월 N회는 어느 날이든 할 수 있다.
// 날짜 지정에서 그달에 없는 날짜(예: 2월 30일)는 그달 말일로 당긴다.
export function isDue(habit, day) {
  if (!habit || day < habit.startDate) return false;
  const schedule = habit.schedule ?? {};
  if (schedule.type === 'weekdays') return (schedule.days ?? []).includes(weekdayOf(day));
  if (schedule.type === 'monthdays') {
    const date = dayOfMonth(day), last = dayOfMonth(monthEnd(day));
    return (schedule.days ?? []).some(d => Math.min(d, last) === date);
  }
  return true;
}

const countBetween = (habit, from, to, test) => {
  let n = 0;
  for (const day of Object.keys(habit?.logs ?? {})) if (day >= from && day <= to && day >= habit.startDate && test(day)) n += 1;
  return n;
};

// 기간(주·달) 목표 횟수. 시작한 기간은 남은 날만큼만, 쉬는 날만큼 줄여서 요구한다.
function targetIn(habit, period, first) {
  const last = period.end(first);
  if (habit.startDate > last) return 0;
  const from = habit.startDate > first ? habit.startDate : first;
  const skipped = countBetween(habit, from, last, day => isSkipped(habit, day));
  return Math.max(0, Math.min(habit.schedule?.count ?? 1, daysBetween(from, last) - skipped));
}
const doneIn = (habit, period, day) =>
  countBetween(habit, period.start(day), period.end(period.start(day)), d => isDone(habit, d));

export const weeklyTarget = (habit, monday) => targetIn(habit, PERIODS.weekly, monday);
export const weekDoneCount = (habit, today) => doneIn(habit, PERIODS.weekly, today);
export const monthlyTarget = (habit, first) => targetIn(habit, PERIODS.monthly, first);
export const monthDoneCount = (habit, today) => doneIn(habit, PERIODS.monthly, today);

// 주 N회·월 N회 습관의 지금 기간 진행: { label: '이번 주'|'이번 달', done, target }. 다른 주기면 null.
export function periodProgress(habit, today) {
  const period = periodOf(habit);
  if (!period) return null;
  return { label: period.unit === '주' ? '이번 주' : '이번 달', done: doneIn(habit, period, today),
    target: targetIn(habit, period, period.start(today)) };
}

/**
 * 연속 기록. 단위는 매일·요일·날짜 습관이면 '일', 주 N회면 '주', 월 N회면 '달'.
 * - 오늘(이번 주)은 아직 진행 중이라 안 했어도 끊지 않는다.
 * - 지난 해야 하는 날(주)을 한 번 빠져도 이어지고, 두 번 연속 빠지면 끊긴다.
 * - 쉬는 날(쉬는 날로만 채워진 주)은 건너뛴다.
 * - missedLast: 바로 전 해야 하는 날(주)을 빠졌는지. "두 번 연속은 피하기" 안내에 쓴다.
 */
export function streakOf(habit, today) {
  if (!habit || today < habit.startDate) return { count: 0, unit: unitOf(habit), missedLast: false, broken: false };
  return isPeriodic(habit) ? periodStreak(habit, today) : dailyStreak(habit, today);
}

export const unitOf = habit => periodOf(habit)?.unit ?? '일';

function walk(periods, unit) {
  // periods: 최근 것부터 [{ done, current }]. current(진행 중)는 안 했어도 빠진 것으로 보지 않는다.
  // 두 번 연속 빠진 지점에서 멈추므로, 그보다 오래된 기록은 세지 않는다.
  let count = 0, misses = 0, broken = false;
  const lastPast = periods.find(p => !p.current);
  for (const period of periods) {
    if (period.done) { count += 1; misses = 0; }
    else if (!period.current && ++misses >= 2) { broken = true; break; }
  }
  return { count, unit, missedLast: Boolean(lastPast && !lastPast.done), broken };
}

const MAX_LOOKBACK_DAYS = 3660;
const stopAfterTwoMisses = periods => periods.length > 2 && periods.slice(-2).every(p => !p.done && !p.current);

function dailyStreak(habit, today) {
  const periods = [];
  for (let i = 0, day = today; i < MAX_LOOKBACK_DAYS && day >= habit.startDate; i += 1, day = addDays(day, -1)) {
    if (!isDue(habit, day) || isSkipped(habit, day)) continue;
    periods.push({ done: isDone(habit, day), current: day === today });
    if (stopAfterTwoMisses(periods)) break;
  }
  return walk(periods, '일');
}

function periodStreak(habit, today) {
  const period = periodOf(habit);
  const periods = [];
  const firstPeriod = period.start(habit.startDate), currentPeriod = period.start(today);
  for (let first = currentPeriod, i = 0; first >= firstPeriod && i < 530; first = period.start(addDays(first, -1)), i += 1) {
    const target = targetIn(habit, period, first);
    if (target === 0) continue;
    periods.push({ done: doneIn(habit, period, first) >= target, current: first === currentPeriod });
    if (stopAfterTwoMisses(periods)) break;
  }
  return walk(periods, period.unit);
}

/**
 * 하루 칸 상태
 * full | tiny | skip | missed(빠짐) | open(오늘·이번 주·이번 달 남은 기회) | empty(주·월 N회의 지난 빈 날)
 * | future | off(쉬는 요일) | before(시작 전)
 */
export function dayState(habit, day, today) {
  if (day < habit.startDate) return 'before';
  const status = statusOf(habit, day);
  if (status) return status;
  if (day > today) return isDue(habit, day) ? 'future' : 'off';
  if (!isDue(habit, day)) return 'off';
  const period = periodOf(habit);
  if (period) return period.start(day) === period.start(today) ? 'open' : 'empty';
  return day === today ? 'open' : 'missed';
}

// 하루 칸 상태 이름(화면 표시용)
export const DAY_STATE_TEXT = { full: '완료', tiny: '최소만 함', skip: '쉬는 날', missed: '빠짐', open: '아직 안 함', empty: '안 함',
  future: '예정', off: '하지 않는 날', before: '시작 전' };

// 이번 주(월~일) 칸
export function weekCells(habit, today) {
  const monday = weekStart(today);
  return WEEK_ORDER.map((_, i) => {
    const day = addDays(monday, i);
    return { day, weekday: weekdayOf(day), state: dayState(habit, day, today), editable: day <= today && day >= habit.startDate };
  });
}

// 날짜 지정(매월 n일) 습관: 해야 하는 날 count칸(지난날 최대 count-1번 + 다가올 날). 주간 칸 대신 쓴다.
export function monthDayCells(habit, today, count = 7) {
  const days = [];
  for (let day = today, i = 0; days.length < count - 1 && i < MAX_LOOKBACK_DAYS && day >= habit.startDate; day = addDays(day, -1), i += 1) {
    if (isDue(habit, day)) days.unshift(day);
  }
  for (let day = addDays(today, 1), i = 0; days.length < count && i < MAX_LOOKBACK_DAYS; day = addDays(day, 1), i += 1) {
    if (isDue(habit, day)) days.push(day);
  }
  return days.map(day => ({ day, state: dayState(habit, day, today), editable: day <= today && day >= habit.startDate }));
}

// 월 N회 습관: 최근 count달(이번 달 포함)의 달성. state는 full | open(이번 달) | missed | skip(쉬는 날로 목표 0) | before
export function monthCells(habit, today, count = 7) {
  const current = monthStart(today);
  const firsts = [current];
  while (firsts.length < count) firsts.unshift(monthStart(addDays(firsts[0], -1)));
  return firsts.map(first => {
    const target = monthlyTarget(habit, first), done = doneIn(habit, PERIODS.monthly, first);
    const state = habit.startDate > monthEnd(first) ? 'before' : target > 0 && done >= target ? 'full'
      : first === current ? 'open' : target === 0 ? 'skip' : 'missed';
    return { first, month: Number(first.slice(5, 7)), done, target, state, current: first === current };
  });
}

// 히트맵: 최근 weeks주(이번 주 포함), 오래된 주부터. 각 주는 월~일 7칸.
export function historyWeeks(habit, today, weeks = HISTORY_WEEKS) {
  const thisMonday = weekStart(today);
  return Array.from({ length: weeks }, (_, w) => {
    const monday = addDays(thisMonday, -7 * (weeks - 1 - w));
    return { monday, days: WEEK_ORDER.map((_, i) => {
      const day = addDays(monday, i);
      return { day, state: dayState(habit, day, today) };
    }) };
  });
}

/**
 * 기간 [from, to]의 해야 하는 일 중 한 비율. 쉬는 날은 빼고 센다.
 * 매일·요일·날짜 습관은 날 단위, 주·월 N회는 횟수 단위(기간마다 목표까지만 인정).
 * 진행 중인 오늘·이번 주·이번 달은 이미 채운 만큼만 넣는다(아직 안 한 걸 실패로 치지 않음).
 */
export function completion(habit, from, to, today) {
  const end = to < today ? to : today;
  const start = from > habit.startDate ? from : habit.startDate;
  let done = 0, total = 0;
  if (start > end) return { done, total, rate: null };
  const period = periodOf(habit);
  if (period) {
    for (let first = period.start(start); first <= end; first = period.next(first)) {
      const target = targetIn(habit, period, first);
      const did = Math.min(target, doneIn(habit, period, first));
      const current = first === period.start(today);
      done += did;
      total += current ? did : target;
    }
  } else {
    for (let day = start; day <= end; day = addDays(day, 1)) {
      if (!isDue(habit, day) || isSkipped(habit, day)) continue;
      const did = isDone(habit, day);
      if (did) done += 1;
      if (did || day < today) total += 1;
    }
  }
  return { done, total, rate: total ? done / total : null };
}

// 지난주 돌아보기: 지난주(월~일)와 그 전 주의 달성 결과. 지난주에 해야 할 일이 없던 습관은 뺀다.
// 월 N회는 한 달 단위 목표라 한 주만 떼어 보면 맞지 않아 뺀다.
export function weekReview(habits, today) {
  const from = addDays(weekStart(today), -7);
  const to = addDays(from, 6);
  const before = addDays(from, -7);
  const items = habits.filter(h => !h.archived && h.schedule?.type !== 'monthly').map(habit => {
    const last = completion(habit, from, to, today);
    const prev = completion(habit, before, addDays(before, 6), today);
    return { habit, done: last.done, total: last.total, rate: last.rate, prevRate: prev.rate };
  }).filter(item => item.total > 0);
  const done = items.reduce((n, item) => n + item.done, 0);
  const total = items.reduce((n, item) => n + item.total, 0);
  return { from, to, items, rate: total ? done / total : null };
}

// 오늘 탭에 보일 습관: 오늘 해야 하거나, 이번 주·이번 달 목표가 남았거나, 오늘 이미 기록한 것.
export function dueToday(habits, today) {
  return habits.filter(habit => {
    if (habit.archived || today < habit.startDate) return false;
    if (statusOf(habit, today)) return true;
    const progress = periodProgress(habit, today);
    if (progress) return progress.done < progress.target;
    return isDue(habit, today);
  });
}

export const totalDone = habit => Object.keys(habit?.logs ?? {})
  .filter(day => day >= habit.startDate && isDone(habit, day)).length;

// 달력 칸 순환: 빈 칸 → 완료 → (최소 버전이 있으면) 최소 → 쉬는 날 → 빈 칸. 횟수 습관의 완료는 목표 횟수.
export function nextCellValue(habit, day) {
  const status = statusOf(habit, day);
  if (!status) return isCountHabit(habit) ? countTarget(habit) : 'full';
  if (status === 'full' && !isCountHabit(habit) && habit.tinyVersion) return 'tiny';
  if (status === 'skip') return null;
  return 'skip';
}

// 횟수 습관의 +1/−1. 0이 되면 기록을 지운다(null).
export function stepCount(habit, day, delta) {
  const next = Math.min(LOG_COUNT_MAX, countOf(habit, day) + delta);
  return next > 0 ? next : null;
}

export function scheduleLabel(schedule) {
  if (schedule?.type === 'daily') return '매일';
  if (schedule?.type === 'weekdays') return WEEK_ORDER.filter(d => schedule.days?.includes(d)).map(d => WEEKDAY_LABELS[d]).join('·');
  if (schedule?.type === 'monthdays') return `매월 ${(schedule.days ?? []).join('·')}일`;
  if (schedule?.type === 'monthly') return `월 ${schedule.count ?? 1}회`;
  return `주 ${schedule?.count ?? 1}회`;
}

// 일주일에 평균 몇 번 하는지. 습관 목록을 자주 하는 순서로 놓을 때 쓴다.
export function weeklyFrequency(schedule) {
  if (schedule?.type === 'daily') return 7;
  if (schedule?.type === 'weekdays') return schedule.days?.length ?? 0;
  if (schedule?.type === 'monthdays') return ((schedule.days?.length ?? 0) * 12) / 52;
  if (schedule?.type === 'monthly') return ((schedule.count ?? 1) * 12) / 52;
  return schedule?.count ?? 1;
}
// 자주 하는 습관부터(매일 → 주 3회 → 주 1회 → 월 1회). 같으면 원래 순서
export const byFrequency = habits => [...habits].sort((a, b) => weeklyFrequency(b.schedule) - weeklyFrequency(a.schedule));

export const countLabel = (habit, n) => `${n}/${countTarget(habit)}${habit.target?.unit || '회'}`;
export const percent = rate => (rate === null ? '–' : `${Math.round(rate * 100)}%`);

// 입력값을 저장 형태로 다듬는다. 잘못된 값이면 { error }를 돌려준다.
export function normalizeHabit(input) {
  const name = String(input?.name ?? '').trim();
  const emoji = String(input?.emoji ?? '').trim();
  const anchor = String(input?.anchor ?? '').trim();
  let tinyVersion = String(input?.tinyVersion ?? '').trim();
  const type = input?.schedule?.type;
  const targetType = input?.target?.type ?? 'check';
  if (!name) return { error: '습관 이름을 입력해 주세요.' };
  if (name.length > NAME_MAX) return { error: `이름은 ${NAME_MAX}자 이하로 입력해 주세요.` };
  if ([...emoji].length > 4) return { error: '이모지는 하나만 넣어 주세요.' };
  if (anchor.length > TEXT_MAX || tinyVersion.length > TEXT_MAX) return { error: `문장은 ${TEXT_MAX}자 이하로 입력해 주세요.` };
  if (!SCHEDULE_TYPES.includes(type)) return { error: '주기를 골라 주세요.' };
  if (!TARGET_TYPES.includes(targetType)) return { error: '목표 방식을 골라 주세요.' };
  if (!isDay(input?.startDate)) return { error: '시작일을 골라 주세요.' };
  let schedule;
  if (type === 'weekly') {
    const count = Number(input.schedule.count);
    if (!Number.isInteger(count) || count < 1 || count > 7) return { error: '주 횟수는 1~7회로 정해 주세요.' };
    schedule = { type, count };
  } else if (type === 'monthly') {
    const count = Number(input.schedule.count);
    if (!Number.isInteger(count) || count < 1 || count > MONTH_DAY_MAX) return { error: `월 횟수는 1~${MONTH_DAY_MAX}회로 정해 주세요.` };
    schedule = { type, count };
  } else if (type === 'weekdays') {
    const days = [...new Set(input.schedule.days ?? [])].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
    if (!days.length) return { error: '요일을 하나 이상 골라 주세요.' };
    schedule = { type, days };
  } else if (type === 'monthdays') {
    const days = [...new Set(input.schedule.days ?? [])].filter(d => Number.isInteger(d) && d >= 1 && d <= MONTH_DAY_MAX).sort((a, b) => a - b);
    if (!days.length) return { error: '날짜를 하나 이상 골라 주세요.' };
    schedule = { type, days };
  } else schedule = { type };
  let target = { type: 'check' };
  if (targetType === 'count') {
    const value = Number(input.target.value);
    const unit = String(input.target.unit ?? '').trim();
    if (!Number.isInteger(value) || value < 2 || value > COUNT_MAX) return { error: `하루 횟수는 2~${COUNT_MAX}회로 정해 주세요.` };
    if (unit.length > UNIT_MAX) return { error: `단위는 ${UNIT_MAX}자 이하로 입력해 주세요.` };
    target = { type: 'count', value, unit };
    tinyVersion = ''; // 횟수 습관은 한 번이라도 하면 최소로 친다
  }
  return { value: { name, emoji, anchor, tinyVersion, schedule, target, startDate: input.startDate } };
}

// ===== 자동화 자가 체크 =====
// 주 1회 "생각하지 않아도 저절로 하게 되나요?"를 1~5점으로 묻는다(자동화 척도 SRBAI를 한 문항으로 줄임).
// 66일 같은 고정 기준 대신 사람마다 다른 속도를 직접 잰다. 점수는 automaticity 맵({ 주의 월요일: 1~5 })에 둔다.
export const AUTOMATICITY_LABELS = ['', '전혀 아니에요', '가끔 그래요', '반반이에요', '대체로 그래요', '완전히 그래요'];
export const SETTLED_SCORE = 4;
export const AUTOMATICITY_MIN_DONE = 3;
export const isValidScore = score => Number.isInteger(score) && score >= 1 && score <= 5;

export function automaticityOf(habit) {
  const history = Object.entries(habit?.automaticity ?? {})
    .filter(([week, score]) => isDay(week) && isValidScore(score))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, score]) => ({ week, score }));
  const latest = history.at(-1) ?? null;
  // 최근 두 번 연속 4점 이상이면 자리 잡은 것으로 본다(곡선이 평평해진 지점).
  const lastTwo = history.slice(-2);
  const settled = lastTwo.length === 2 && lastTwo.every(h => h.score >= SETTLED_SCORE);
  return { history, latest, settled };
}

// 이번 주에 물어볼지: 시작한 지 일주일이 지났고, 세 번 이상 했고, 이번 주에 아직 답하지 않았을 때
export function automaticityDue(habit, today) {
  if (!habit || habit.archived || today < addDays(habit.startDate, 7)) return false;
  if (totalDone(habit) < AUTOMATICITY_MIN_DONE) return false;
  return !isValidScore(habit.automaticity?.[weekStart(today)]);
}
