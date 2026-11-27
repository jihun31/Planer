export const optionId = '__planer_builtin_rest__';
export const restName = '휴식';
export const color = '#6366f1';
export const presets = [5, 10, 15, 30];
export const minute = 60_000;
export const keyFor = uid => `planer:rest-plan:v1:${uid}`;
export const isRestName = name => typeof name === 'string' && name.normalize('NFKC').trim() === restName;
export const findRest = activities => activities.find(activity => isRestName(activity.name));
export const isMinutes = value => Number.isInteger(value) && value >= 1 && value <= 1440;
export const isDuration = value => value === null || isMinutes(value);
export const hasEnded = (session, now) => session.endTs !== null && session.endTs <= now;
export const sessionKey = session => `${session.startTs}:${session.endTs}`;

export function read(uid) {
  let data;
  try { data = JSON.parse(localStorage.getItem(keyFor(uid))); } catch { /* Use defaults. */ }
  const activities = Array.isArray(data?.activities)
    ? data.activities.filter(item => typeof item?.id === 'string' && typeof item.name === 'string' && item.name.trim())
    : [];
  const session = data?.session;
  const validSession = session && Number.isFinite(session.startTs)
    && (session.endTs === null || (Number.isFinite(session.endTs) && session.endTs >= session.startTs))
    && typeof session.name === 'string' && typeof session.action === 'string';
  return {
    activities,
    minutes: isDuration(data?.minutes) ? data.minutes : 10,
    session: validSession ? session : null,
  };
}
