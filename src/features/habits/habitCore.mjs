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
export const SCHEDULE_TYPES = ['weekly', 'daily', 'weekdays'];
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

// 그날 해야 하는 날인지(쉬는 날 여부와는 별개). 주 N회는 어느 날이든 할 수 있다.
export function isDue(habit, day) {
  if (!habit || day < habit.startDate) return false;
  const schedule = habit.schedule ?? {};
  if (schedule.type === 'weekdays') return (schedule.days ?? []).includes(weekdayOf(day));
  return true;
}

const countBetween = (habit, from, to, test) => {
  let n = 0;
  for (const day of Object.keys(habit?.logs ?? {})) if (day >= from && day <= to && day >= habit.startDate && test(day)) n += 1;
  return n;
};

// 주 N회 목표. 시작한 주는 남은 날만큼만, 쉬는 날만큼 줄여서 요구한다.
export function weeklyTarget(habit, monday) {
  const sunday = addDays(monday, 6);
  if (habit.startDate > sunday) return 0;
  const first = habit.startDate > monday ? habit.startDate : monday;
  const days = 7 - ((weekdayOf(first) + 6) % 7);
  const skipped = countBetween(habit, first, sunday, day => isSkipped(habit, day));
  return Math.max(0, Math.min(habit.schedule?.count ?? 1, days - skipped));
}

export const weekDoneCount = (habit, today) =>
  countBetween(habit, weekStart(today), addDays(weekStart(today), 6), day => isDone(habit, day));

/**
 * 연속 기록. 단위는 매일·요일 습관이면 '일', 주 N회면 '주'.
 * - 오늘(이번 주)은 아직 진행 중이라 안 했어도 끊지 않는다.
 * - 지난 해야 하는 날(주)을 한 번 빠져도 이어지고, 두 번 연속 빠지면 끊긴다.
 * - 쉬는 날(쉬는 날로만 채워진 주)은 건너뛴다.
 * - missedLast: 바로 전 해야 하는 날(주)을 빠졌는지. "두 번 연속은 피하기" 안내에 쓴다.
 */
export function streakOf(habit, today) {
  if (!habit || today < habit.startDate) return { count: 0, unit: unitOf(habit), missedLast: false, broken: false };
  return habit.schedule?.type === 'weekly' ? weeklyStreak(habit, today) : dailyStreak(habit, today);
}

export const unitOf = habit => (habit?.schedule?.type === 'weekly' ? '주' : '일');

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

function weeklyStreak(habit, today) {
  const periods = [];
  const firstMonday = weekStart(habit.startDate);
  for (let monday = weekStart(today), i = 0; monday >= firstMonday && i < 530; monday = addDays(monday, -7), i += 1) {
    const target = weeklyTarget(habit, monday);
    if (target === 0) continue;
    const current = monday === weekStart(today);
    periods.push({ done: weekDoneCount(habit, monday) >= target, current });
    if (stopAfterTwoMisses(periods)) break;
  }
  return walk(periods, '주');
}

/**
 * 하루 칸 상태
 * full | tiny | skip | missed(빠짐) | open(오늘·이번 주 남은 기회) | empty(주 N회의 지난 빈 날)
 * | future | off(쉬는 요일) | before(시작 전)
 */
export function dayState(habit, day, today) {
  if (day < habit.startDate) return 'before';
  const status = statusOf(habit, day);
  if (status) return status;
  if (day > today) return isDue(habit, day) ? 'future' : 'off';
  if (!isDue(habit, day)) return 'off';
  if (habit.schedule?.type === 'weekly') return weekStart(day) === weekStart(today) ? 'open' : 'empty';
  return day === today ? 'open' : 'missed';
}

// 이번 주(월~일) 칸
export function weekCells(habit, today) {
  const monday = weekStart(today);
  return WEEK_ORDER.map((_, i) => {
    const day = addDays(monday, i);
    return { day, weekday: weekdayOf(day), state: dayState(habit, day, today), editable: day <= today && day >= habit.startDate };
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
 * 매일·요일 습관은 날 단위, 주 N회는 횟수 단위(주마다 목표까지만 인정).
 * 진행 중인 오늘·이번 주는 이미 채운 만큼만 넣는다(아직 안 한 걸 실패로 치지 않음).
 */
export function completion(habit, from, to, today) {
  const end = to < today ? to : today;
  const start = from > habit.startDate ? from : habit.startDate;
  let done = 0, total = 0;
  if (start > end) return { done, total, rate: null };
  if (habit.schedule?.type === 'weekly') {
    for (let monday = weekStart(start); monday <= end; monday = addDays(monday, 7)) {
      const target = weeklyTarget(habit, monday);
      const did = Math.min(target, weekDoneCount(habit, monday));
      const current = monday === weekStart(today);
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
export function weekReview(habits, today) {
  const from = addDays(weekStart(today), -7);
  const to = addDays(from, 6);
  const before = addDays(from, -7);
  const items = habits.filter(h => !h.archived).map(habit => {
    const last = completion(habit, from, to, today);
    const prev = completion(habit, before, addDays(before, 6), today);
    return { habit, done: last.done, total: last.total, rate: last.rate, prevRate: prev.rate };
  }).filter(item => item.total > 0);
  const done = items.reduce((n, item) => n + item.done, 0);
  const total = items.reduce((n, item) => n + item.total, 0);
  return { from, to, items, rate: total ? done / total : null };
}

// 오늘 탭에 보일 습관: 오늘 해야 하거나, 이번 주 목표가 남았거나, 오늘 이미 기록한 것.
export function dueToday(habits, today) {
  return habits.filter(habit => {
    if (habit.archived || today < habit.startDate) return false;
    if (statusOf(habit, today)) return true;
    if (habit.schedule?.type === 'weekly') return weekDoneCount(habit, today) < weeklyTarget(habit, weekStart(today));
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
  return `주 ${schedule?.count ?? 1}회`;
}

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
  } else if (type === 'weekdays') {
    const days = [...new Set(input.schedule.days ?? [])].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
    if (!days.length) return { error: '요일을 하나 이상 골라 주세요.' };
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

// ===== 배지: 누적 횟수 기준 =====
// 자동화는 연속 여부가 아니라 반복이 쌓이며 생기므로(Lally 외 2010) 연속 기록이 끊겨도 배지 진행은 남는다.
export const BADGE_MILESTONES = [
  { count: 7, tier: 'bronze', label: '첫 일주일' },
  { count: 30, tier: 'silver', label: '30회' },
  { count: 66, tier: 'gold', label: '66회' },
  { count: 100, tier: 'navy', label: '100회' },
];

export function badgesOf(habit) {
  const total = totalDone(habit);
  const earned = BADGE_MILESTONES.filter(b => total >= b.count);
  const next = BADGE_MILESTONES.find(b => total < b.count) ?? null;
  return { total, earned, next: next && { ...next, remaining: next.count - total } };
}

// 기록을 바꾼 뒤 새로 받은 배지(없으면 null)
export function crossedBadge(before, after) {
  const a = totalDone(before), b = totalDone(after);
  return BADGE_MILESTONES.findLast(m => a < m.count && b >= m.count) ?? null;
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
