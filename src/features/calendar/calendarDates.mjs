export const EVENT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

// Calendar dates change at midnight, independently of the planner's 05:00 boundary.
export function calendarToday(now = new Date()) {
  return formatCalendarDate(now);
}

export function formatCalendarDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000 || year > 9999) return false;
  return formatCalendarDate(new Date(year, month - 1, day, 12)) === value;
}

export function monthGrid(month, minimumWeeks = 0) {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(year, number - 1, 1, 12);
  const length = Math.max(minimumWeeks * 7, Math.ceil((first.getDay() + new Date(year, number, 0).getDate()) / 7) * 7);
  return Array.from({ length }, (_, index) => formatCalendarDate(
    new Date(year, number - 1, 1 - first.getDay() + index, 12)));
}

export function shiftCalendarMonth(date, delta) {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(year, month - 1 + delta, 1, 12);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return formatCalendarDate(target);
}

export function calendarDateLabel(date) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(year, month - 1, day, 12).getDay()];
  return `${month}월 ${day}일 (${weekday})`;
}

export function eventInput(data) {
  const title = String(data.title ?? '').trim();
  const note = String(data.note ?? '').trim();
  if (!title || title.length > 120) throw new Error('제목은 1~120자로 입력해 주세요.');
  if (!isCalendarDate(data.date)) throw new Error('올바른 날짜를 선택해 주세요.');
  if (note.length > 5000) throw new Error('메모는 5,000자까지 입력할 수 있습니다.');
  if (!EVENT_COLORS.includes(data.color)) throw new Error('일정 색상을 선택해 주세요.');
  return { title, date: data.date, note, color: data.color };
}
