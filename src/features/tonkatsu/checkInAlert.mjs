// 돈까스 인증 PC 알림 규칙. 시각은 하루 기준과 같은 한국 시간으로 센다.
import { CATEGORY_KR, DAY_START_HOUR, addDays, baseDate, countInMonth, countInWeek, iterPlans, lastDayOfMonth,
  monthlyTarget, WEEKDAY_NAMES, weekBounds, weekday, weeklyTarget } from './tonkatsuCore.mjs';

export const DEFAULT_ALERT_TIME = '00:30';
const KST_OFFSET_MS = 9 * 3600e3;

/** 'HH:MM' 형식이면 그대로, 아니면 null */
export function parseAlertTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? '');
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

/** 하루(date, 5시 기준) 안에서 알림 시각의 실제 시점(ms). 0~4시는 다음 달력 날짜의 새벽 */
export function alertMoment(date, time) {
  const parsed = parseAlertTime(time);
  if (!parsed) return null;
  const day = parsed.hour < DAY_START_HOUR ? addDays(date, 1) : date;
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d, parsed.hour, parsed.minute) - KST_OFFSET_MS;
}

/**
 * 오늘 인증하지 않으면 오늘 밤 정산에서 벌금이 되는 계획 (bot/core.py find_missed_plans 기준).
 * 주간·월간은 마지막 날(일요일·말일)에 목표가 모자랄 때만, 반복·제한 계획은 넣지 않는다.
 */
export function dueTodayPlans(view, date) {
  if ((view.rest_history || []).includes(date) || (view.exemptions || []).includes(date)) return [];
  const due = [];
  for (const [category, plan] of iterPlans(view, ['Daily', 'Routine', 'Weekly', 'Monthly', 'OneTime'])) {
    const history = plan.history || [];
    const started = plan.created_at || '2000-01-01';
    if (history.includes(date)) continue;
    if (category === 'Daily') { if (date >= started) due.push([category, plan]); }
    else if (category === 'Routine') {
      if (date >= started && (plan.days || []).includes(WEEKDAY_NAMES[weekday(date)])) due.push([category, plan]);
    } else if (category === 'Weekly') {
      if (weekday(date) === 6 && started <= weekBounds(date)[0] && countInWeek(history, date) < weeklyTarget(view, plan, date)) due.push([category, plan]);
    } else if (category === 'Monthly') {
      if (Number(date.slice(8)) === lastDayOfMonth(date) && started <= `${date.slice(0, 7)}-01`
        && countInMonth(history, date) < monthlyTarget(view, plan, date)) due.push([category, plan]);
    } else if (plan.deadline === date && !plan.completed) due.push([category, plan]);
  }
  return due;
}

/**
 * 지금 알림을 보내야 하는지. 알림 시각이 지났고 그날 아직 보내지 않았으면 그날 날짜를 돌려준다.
 * 앱을 알림 시각 뒤(정산 전)에 켰거나 절전에서 깨어났으면 그때 보낸다.
 */
export function alertDateDue(time, sentDate, nowMs = Date.now()) {
  const date = baseDate(nowMs);
  const moment = alertMoment(date, time);
  return moment !== null && nowMs >= moment && sentDate !== date ? date : null;
}

export function alertMessage(due) {
  const names = due.map(([category, plan]) => `[${CATEGORY_KR[category]}] ${plan.content}`);
  const shown = names.slice(0, 4).join('\n');
  return {
    title: `돈까스 인증 ${due.length}개가 남았어요`,
    body: names.length > 4 ? `${shown}\n외 ${names.length - 4}개` : shown,
  };
}
