export const COLORS = [
  '#6366f1', '#3b82f6', '#22c55e', '#eab308', '#f97316',
  '#ef4444', '#ec4899', '#14b8a6', '#8b5cf6', '#6b7280',
];
export const MINUTES_ARR = Array.from({ length: 60 }, (_, i) => i);
export const CUSTOM_ID = '__custom__';
export const minToTime = min => {
  const total = 8 * 60 + min;
  const h = ((Math.floor(total / 60) % 24) + 24) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
export const fmtHour = h => `${String(h >= 24 ? h - 24 : h).padStart(2, '0')}:00`;
export const fmtMins = mins => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
};
export const fmtElapsed = s => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
};
