// 습관 규칙(순수 함수). 날짜는 'YYYY-MM-DD' 문자열, 하루는 새벽 5시에 바뀐다.
//
// 근거로 삼은 연구:
// - 하루 빠진 영향은 작고 길게 빠지면 크게 흔들린다(Lally 외 2010) → 해야 하는 날을 한 번 빠져도 연속 기록은
//   이어지고, 두 번 연속 빠지면 끊긴다.
// - 아주 작은 행동부터 시작한다(Fogg, Tiny Habits) → 최소 버전('tiny')만 해도 그날은 한 것으로 센다.
// - 고정 일정보다 유연한 일정이 더 오래 간다(Beshears 외 2021) → 기본 주기는 '주 N회'.

export const DAY_START_HOUR = 5;
export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
// 화면에 그리는 요일 순서(월요일 시작)
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const SCHEDULE_TYPES = ['weekly', 'daily', 'weekdays'];
export const LOG_VALUES = ['full', 'tiny'];
export const NAME_MAX = 40;
export const TEXT_MAX = 80;

const pad = n => String(n).padStart(2, '0');
export const formatDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = value => typeof value === 'string' && DAY_RE.test(value) && formatDay(parseDay(value)) === value;
// 정오로 잡아 서머타임 경계에서도 날짜가 밀리지 않게 한다.
export const parseDay = day => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (day, n) => { const d = parseDay(day); d.setDate(d.getDate() + n); return formatDay(d); };
export const weekdayOf = day => parseDay(day).getDay();
export const weekStart = day => addDays(day, -((weekdayOf(day) + 6) % 7));

export function dayKey(now = new Date()) {
  const d = new Date(now);
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  return formatDay(d);
}

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

export const logOf = (habit, day) => habit?.logs?.[day] ?? null;
export const isDone = (habit, day) => LOG_VALUES.includes(logOf(habit, day));

// 그날 해야 하는 날인지. 주 N회는 어느 날이든 할 수 있다.
export function isDue(habit, day) {
  if (!habit || day < habit.startDate) return false;
  const schedule = habit.schedule ?? {};
  if (schedule.type === 'weekdays') return (schedule.days ?? []).includes(weekdayOf(day));
  return true;
}

const doneBetween = (habit, from, to) =>
  Object.entries(habit?.logs ?? {}).filter(([day, value]) => day >= from && day <= to && LOG_VALUES.includes(value)).length;

// 주 N회 목표. 시작한 주는 남은 날 수만큼만 요구한다.
export function weeklyTarget(habit, monday) {
  const count = habit.schedule?.count ?? 1;
  const sunday = addDays(monday, 6);
  if (habit.startDate > sunday) return 0;
  if (habit.startDate <= monday) return count;
  const daysLeft = 7 - ((weekdayOf(habit.startDate) + 6) % 7);
  return Math.min(count, daysLeft);
}

export const weekDoneCount = (habit, today) => doneBetween(habit, weekStart(today), addDays(weekStart(today), 6));

/**
 * 연속 기록. 단위는 매일·요일 습관이면 '일', 주 N회면 '주'.
 * - 오늘(이번 주)은 아직 진행 중이라 안 했어도 끊지 않는다.
 * - 지난 해야 하는 날(주)을 한 번 빠져도 이어지고, 두 번 연속 빠지면 끊긴다.
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

function dailyStreak(habit, today) {
  const periods = [];
  for (let i = 0, day = today; i < MAX_LOOKBACK_DAYS && day >= habit.startDate; i += 1, day = addDays(day, -1)) {
    if (!isDue(habit, day)) continue;
    periods.push({ done: isDone(habit, day), current: day === today });
    if (periods.length > 2 && periods.slice(-2).every(p => !p.done && !p.current)) break;
  }
  return walk(periods, '일');
}

function weeklyStreak(habit, today) {
  const periods = [];
  const firstMonday = weekStart(habit.startDate);
  for (let monday = weekStart(today), i = 0; monday >= firstMonday && i < 530; monday = addDays(monday, -7), i += 1) {
    const target = weeklyTarget(habit, monday);
    const current = monday === weekStart(today);
    const done = target > 0 && doneBetween(habit, monday, addDays(monday, 6)) >= target;
    periods.push({ done, current });
    if (periods.length > 2 && periods.slice(-2).every(p => !p.done && !p.current)) break;
  }
  return walk(periods, '주');
}

// 이번 주(월~일) 칸 상태: full | tiny | missed | open(오늘·이번 주 남은 기회) | future | off(쉬는 요일) | before(시작 전)
export function weekCells(habit, today) {
  const monday = weekStart(today);
  return WEEK_ORDER.map((_, i) => {
    const day = addDays(monday, i);
    const log = logOf(habit, day);
    let state;
    if (day < habit.startDate) state = 'before';
    else if (LOG_VALUES.includes(log)) state = log;
    else if (day > today) state = isDue(habit, day) ? 'future' : 'off';
    else if (!isDue(habit, day)) state = 'off';
    else if (day === today || habit.schedule?.type === 'weekly') state = 'open';
    else state = 'missed';
    return { day, weekday: weekdayOf(day), state, editable: day <= today && day >= habit.startDate };
  });
}

// 오늘 탭에 보일 습관: 오늘 해야 하거나, 이번 주 목표가 남았거나, 오늘 이미 한 것.
export function dueToday(habits, today) {
  return habits.filter(habit => {
    if (habit.archived || today < habit.startDate) return false;
    if (isDone(habit, today)) return true;
    if (habit.schedule?.type === 'weekly') return weekDoneCount(habit, today) < weeklyTarget(habit, weekStart(today));
    return isDue(habit, today);
  });
}

export const totalDone = habit => Object.entries(habit?.logs ?? {})
  .filter(([day, value]) => day >= habit.startDate && LOG_VALUES.includes(value)).length;

export function scheduleLabel(schedule) {
  if (schedule?.type === 'daily') return '매일';
  if (schedule?.type === 'weekdays') return WEEK_ORDER.filter(d => schedule.days?.includes(d)).map(d => WEEKDAY_LABELS[d]).join('·');
  return `주 ${schedule?.count ?? 1}회`;
}

// 입력값을 저장 형태로 다듬는다. 잘못된 값이면 { error }를 돌려준다.
export function normalizeHabit(input) {
  const name = String(input?.name ?? '').trim();
  const emoji = String(input?.emoji ?? '').trim();
  const anchor = String(input?.anchor ?? '').trim();
  const tinyVersion = String(input?.tinyVersion ?? '').trim();
  const type = input?.schedule?.type;
  if (!name) return { error: '습관 이름을 입력해 주세요.' };
  if (name.length > NAME_MAX) return { error: `이름은 ${NAME_MAX}자 이하로 입력해 주세요.` };
  if ([...emoji].length > 4) return { error: '이모지는 하나만 넣어 주세요.' };
  if (anchor.length > TEXT_MAX || tinyVersion.length > TEXT_MAX) return { error: `문장은 ${TEXT_MAX}자 이하로 입력해 주세요.` };
  if (!SCHEDULE_TYPES.includes(type)) return { error: '주기를 골라 주세요.' };
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
  return { value: { name, emoji, anchor, tinyVersion, schedule, startDate: input.startDate } };
}
