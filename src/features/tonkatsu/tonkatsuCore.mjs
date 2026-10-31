// 돈까스봇 계산 규칙 (bot/core.py와 같은 규칙). 결과가 같은지 tests/tonkatsu-core.test.mjs가 확인합니다.
// 날짜는 모두 'YYYY-MM-DD' 문자열이고, 한국 시간 새벽 5시를 하루의 시작으로 봅니다 (PC 시간대와 무관).

export const DAY_START_HOUR = 5;
export const WEEKDAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];
export const PLAN_CATEGORIES = ['Daily', 'Routine', 'Weekly', 'Monthly', 'Interval', 'OneTime', 'Limit'];
export const CATEGORY_KR = { Daily: '일일', Routine: '요일', Weekly: '주간', Monthly: '월간', Interval: '반복', OneTime: '목표', Limit: '제한' };
export const LIMIT_PERIOD_KR = { day: '하루', week: '이번 주', month: '이번 달' };
const KST_OFFSET_MS = 9 * 3600e3;

const pad = (n) => String(n).padStart(2, '0');
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fmt = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

export const addDays = (s, n) => fmt(parse(s) + n * 86400e3);
export const daysBetween = (later, earlier) => Math.round((parse(later) - parse(earlier)) / 86400e3);
export const weekday = (s) => (new Date(parse(s)).getUTCDay() + 6) % 7; // 월요일 0
export const lastDayOfMonth = (s) => new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)), 0)).getUTCDate();

export function kstHour(nowMs = Date.now()) {
  return new Date(nowMs + KST_OFFSET_MS).getUTCHours();
}
/** 하루 기준 날짜: 한국 시간 0~4시는 전날 */
export function baseDate(nowMs = Date.now()) {
  // 한국 시간에서 5시간을 빼면, 0~4시는 전날 날짜가 됨
  return fmt(nowMs + KST_OFFSET_MS - DAY_START_HOUR * 3600e3);
}
export const isDawn = (nowMs = Date.now()) => kstHour(nowMs) < DAY_START_HOUR;
export const resolveTarget = (value, nowMs = Date.now()) => (value === 'yesterday' ? addDays(baseDate(nowMs), -1) : baseDate(nowMs));

export function* iterPlans(view, categories = PLAN_CATEGORIES) {
  for (const category of categories) for (const plan of view[category] || []) yield [category, plan];
}

export function weekBounds(date) {
  const start = addDays(date, -weekday(date));
  return [start, addDays(start, 7)];
}
export function countInWeek(history, date) {
  const [start, next] = weekBounds(date);
  return history.filter((d) => start <= d && d < next).length;
}
export const countInMonth = (history, date) => history.filter((d) => d.startsWith(date.slice(0, 7))).length;
export function countInPeriod(history, date, period) {
  if (period === 'day') return history.filter((d) => d === date).length;
  return period === 'week' ? countInWeek(history, date) : countInMonth(history, date);
}
export function limitStatus(plan, date) {
  const period = plan.period || 'week';
  return { count: countInPeriod(plan.history || [], date, period), limit: plan.limit ?? 0, periodKr: LIMIT_PERIOD_KR[period] || period };
}
export function countOffDays(view, start, end) {
  const off = new Set([...(view.rest_history || []), ...(view.exemptions || [])]);
  return [...off].filter((d) => start <= d && d <= end).length;
}
export function weeklyTarget(view, plan, date) {
  const [start] = weekBounds(date);
  return Math.max(0, (plan.count ?? 1) - countOffDays(view, start, addDays(start, 6)));
}
export function monthlyTarget(view, plan, date) {
  const prefix = date.slice(0, 7);
  return Math.max(0, (plan.count ?? 1) - countOffDays(view, `${prefix}-01`, `${prefix}-${pad(lastDayOfMonth(date))}`));
}

/** 인증 후 '현재 진행 상황'의 [표시, 설명] (core.plan_progress_line) */
export function progressLine(view, category, plan, date) {
  const history = plan.history || [];
  if (category === 'Daily' || category === 'Routine')
    return [history.includes(date) ? '✅' : '⬜', category === 'Daily' ? '[매일]' : '[요일]'];
  if (category === 'Weekly' || category === 'Monthly') {
    const [count, target] = category === 'Weekly'
      ? [countInWeek(history, date), weeklyTarget(view, plan, date)]
      : [countInMonth(history, date), monthlyTarget(view, plan, date)];
    return [count >= target ? '✅' : history.includes(date) ? '☑️' : '⬜', `[${count}/${target}회]`];
  }
  if (category === 'Interval') {
    const interval = plan.interval ?? 2, text = `[${interval}일장]`;
    if (!history.length) return ['🚨', text];
    if (history.at(-1) === date) return ['✅', text + '(완료)'];
    const diff = daysBetween(date, history.at(-1));
    if (diff > interval) return ['🚨', text + `(D+${diff - interval})`];
    if (diff === interval) return ['🔥', text + '(오늘 마감!)'];
    return ['💤', text + `(D-${interval - diff})`];
  }
  if (category === 'Limit') {
    const { count, limit, periodKr } = limitStatus(plan, date);
    return [count > limit ? '🚨' : count === limit ? '⚠️' : '🟢', `[제한 ${periodKr} ${count}/${limit}회]`];
  }
  if (plan.completed) return ['🏆', '[목표달성]'];
  const left = daysBetween(plan.deadline || '9999-12-31', date);
  if (left < 0) return ['💀', `[마감지남 D+${-left}]`];
  if (left === 0) return ['🔥', '[오늘마감]'];
  return ['⏳', `[D-${left}]`];
}

/** 그날 인증할 수 있으면 태그, 인증할 필요가 없으면 null (core.autocomplete_tag) */
export function checkInTag(view, category, plan, date) {
  const history = plan.history || [];
  if (category === 'Limit') {
    const { count, limit, periodKr } = limitStatus(plan, date);
    return `제한 ${periodKr} ${count}/${limit}회` + (count > limit ? ' 🚨초과' : '');
  }
  if (history.includes(date)) return null;
  if (category === 'Daily') return '일일';
  if (category === 'Routine') {
    const days = plan.days || [];
    return days.length && !days.includes(WEEKDAY_NAMES[weekday(date)]) ? null : '요일';
  }
  if (category === 'Weekly') {
    const target = weeklyTarget(view, plan, date);
    return countInWeek(history, date) >= target ? null : `주${target}회`;
  }
  if (category === 'Monthly') return countInMonth(history, date) >= monthlyTarget(view, plan, date) ? null : '월간';
  if (category === 'Interval') {
    const interval = plan.interval ?? 1;
    if (!history.length) return `${interval}일장/시작전`;
    const diff = daysBetween(date, history.at(-1));
    if (diff < interval) return `${interval}일장/D-${interval - diff}`;
    if (diff === interval) return `${interval}일장/오늘마감`;
    return `${interval}일장/D+${diff - interval}`;
  }
  return plan.completed ? null : `~${plan.deadline || '날짜미정'}`;
}

/** Firestore 문서 → 멤버별 뷰 (bot/store.py all_views와 같은 형식) */
export function buildViews({ plans = [], checkIns = [], offDays = [], members = [] }) {
  const history = new Map();
  for (const c of checkIns) {
    if (!c.planId || !c.date) continue;
    if (!history.has(c.planId)) history.set(c.planId, []);
    history.get(c.planId).push(c.date);
  }
  const views = {};
  const viewOf = (owner) => (views[owner] ||= { completed_goals: [], rest_history: [], exemptions: [], fines: 0, alert_time: 2 });
  for (const m of members) {
    const v = viewOf(m.id);
    v.fines = m.fines || 0;
    v.alert_time = m.alertHour ?? 2;
    v.display_name = m.displayName || m.id;
  }
  const sortTime = (p) => p.createdAt?.toMillis?.() ?? 0;
  const sorted = [...plans].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '') || sortTime(a) - sortTime(b) || a.id.localeCompare(b.id));
  for (const doc of sorted) {
    const status = doc.status || 'active';
    if (!doc.ownerId || !PLAN_CATEGORIES.includes(doc.category) || !doc.content || status === 'deleted') continue;
    const plan = { ...doc, history: [...(history.get(doc.id) || [])].sort(), created_at: doc.startDate || '2000-01-01',
      completed: status === 'completed', completed_at: doc.completedAt ?? null };
    const v = viewOf(doc.ownerId);
    if (status === 'completed') v.completed_goals.push(plan);
    else (v[doc.category] ||= []).push(plan);
  }
  for (const off of offDays) {
    if (!off.ownerId || !off.date) continue;
    viewOf(off.ownerId)[off.type === 'rest' ? 'rest_history' : 'exemptions'].push(off.date);
  }
  for (const v of Object.values(views)) { v.rest_history.sort(); v.exemptions.sort(); }
  return views;
}
