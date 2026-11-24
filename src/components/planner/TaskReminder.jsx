import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DAY_START_HOUR, plannerDate } from '../../features/planner/scheduleTime.mjs';
import { PLAN_SLOTS, isSkipped, planChecked, planHabits, planToggleValue } from '../../features/habits/habitCore.mjs';

const SLOT_ORDER = new Map([['오전', 0], ['오후', 1], ['저녁', 2]]);
const slotIndex = item => SLOT_ORDER.get(item.timeSlot) ?? SLOT_ORDER.size;

// 할 일과 하루 계획에 고정한 습관을 한 줄에 같이 보여 주려고 같은 모양으로 바꾼다.
// 같은 칸 안에서는 하루 계획 화면(TodayMain)처럼 습관이 할 일보다 먼저 온다. 쉬는 날로 기록한 습관은 뺀다.
function reminderItems(tasks, habits, date) {
  const taskItems = tasks.filter(task => task.dueDate === date).map(task => ({
    key: task.id, title: task.title, label: task.title, timeSlot: task.timeSlot, checked: Boolean(task.completed),
    habitFirst: 1, order: task.createdAtMs ?? 0, task,
  }));
  const habitItems = PLAN_SLOTS.flatMap(slot => planHabits(habits, date, slot))
    .filter(habit => !isSkipped(habit, date))
    .map((habit, order) => ({
      key: 'habit-' + habit.id, title: (habit.emoji ? habit.emoji + ' ' : '') + habit.name, label: habit.name, timeSlot: habit.planSlot,
      checked: planChecked(habit, date), habitFirst: 0, order, habit,
    }));
  return [...habitItems, ...taskItems]
    .sort((a, b) => slotIndex(a) - slotIndex(b) || a.habitFirst - b.habitFirst || a.order - b.order);
}

function useReminderDate() {
  const [date, setDate] = useState(() => plannerDate());
  useEffect(() => {
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      const current = new Date();
      setDate(plannerDate(current));

      const next = new Date(current);
      if (current.getHours() >= DAY_START_HOUR) next.setDate(next.getDate() + 1);
      next.setHours(DAY_START_HOUR, 0, 0, 0);
      timer = setTimeout(refresh, next - current);
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return date;
}

function useFittingCount(measureRef, items) {
  const [count, setCount] = useState(0);
  useLayoutEffect(() => {
    const row = measureRef.current;
    if (!row) return;
    // 접힌 한 줄에 들어갈 항목을 실제 글자 너비와 버튼 너비로 계산한다.
    const children = Array.from(row.children);
    const more = children.pop();

    const measure = () => {
      const available = row.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(row).columnGap);
      const widths = children.map(item => item.getBoundingClientRect().width + gap);
      const total = widths.reduce((sum, width) => sum + width, 0) - gap;
      if (total <= available) {
        setCount(children.length);
        return;
      }

      const buttonWidth = more.getBoundingClientRect().width;
      const digits = String(children.length).length;
      const digitWidth = more.firstElementChild.getBoundingClientRect().width / digits;
      let used = 0;
      let nextCount = 0;
      for (const width of widths) {
        used += width;
        const remainingDigits = String(children.length - nextCount - 1).length;
        if (used + buttonWidth - (digits - remainingDigits) * digitWidth > available) break;
        nextCount++;
      }
      setCount(nextCount);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const item of row.children) observer.observe(item);
    return () => observer.disconnect();
  }, [measureRef, items]);
  return count;
}

function ReminderItem({ item, measuring, pending, onToggle }) {
  const details = <>
    {item.timeSlot && <span className="task-reminder-slot">{item.timeSlot}</span>}
    {measuring ? <span className="task-reminder-check" />
      : <input type="checkbox" className="task-reminder-check" aria-label={item.label + ' 완료'}
          checked={item.checked} disabled={pending} onChange={() => onToggle(item)} />}
    <span className="task-reminder-title" title={measuring ? undefined : item.title}>{item.title}</span>
  </>;
  return measuring ? <span className="task-reminder-item">{details}</span>
    : <label className="task-reminder-item">{details}</label>;
}

// habits·onSetHabitLog: 하루 계획에 고정한 습관도 보여 주고, 체크하면 습관 기록(logs)에 저장한다.
export default function TaskReminder({ tasks, onToggle, habits = [], onSetHabitLog }) {
  const date = useReminderDate();
  const items = useMemo(() => reminderItems(tasks, habits, date), [tasks, habits, date]);

  const expandedId = useId();
  const [expandedDate, setExpandedDate] = useState(null);
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [errorDate, setErrorDate] = useState(null);
  const measureRef = useRef(null);
  const count = useFittingCount(measureRef, items);
  const extra = items.slice(count);
  const expanded = expandedDate === date && extra.length > 0;

  const toggle = async item => {
    setPendingIds(ids => new Set(ids).add(item.key));
    setErrorDate(null);
    try {
      if (item.habit) {
        if (!onSetHabitLog) throw new Error('Habit log is unavailable');
        await onSetHabitLog(item.habit.id, date, planToggleValue(item.habit, date));
      } else await onToggle(item.task.id, item.checked);
    } catch {
      setErrorDate(date);
    } finally {
      setPendingIds(ids => {
        const next = new Set(ids);
        next.delete(item.key);
        return next;
      });
    }
  };

  if (!items.length && errorDate !== date) return null;
  return (
    <section className="task-reminder" aria-label="오늘 할 일"
      onKeyDown={event => { if (event.key === 'Tab') event.stopPropagation(); }}>
      {items.length > 0 && <>
        <div className="task-reminder-line task-reminder-measure" ref={measureRef} aria-hidden="true">
          {items.map(item => <ReminderItem key={item.key} item={item} measuring />)}
          <span className="task-reminder-more">+<span>{items.length}</span>개 더 보기</span>
        </div>
        <div className="task-reminder-line">
          {items.slice(0, count).map(item => <ReminderItem key={item.key} item={item}
            pending={pendingIds.has(item.key)} onToggle={toggle} />)}
          {extra.length > 0 && <button type="button" className="task-reminder-more"
            aria-expanded={expanded} aria-controls={expandedId} onClick={() => setExpandedDate(expanded ? null : date)}>
            {expanded ? '접기' : '+' + extra.length + '개 더 보기'}
          </button>}
        </div>
        <div className="task-reminder-extra" id={expandedId} hidden={!expanded}>
          {expanded && extra.map(item => <ReminderItem key={item.key} item={item}
            pending={pendingIds.has(item.key)} onToggle={toggle} />)}
        </div>
      </>}
      {errorDate === date && <p className="task-reminder-error" role="alert">할 일 상태를 저장하지 못했습니다. 다시 시도해 주세요.</p>}
    </section>
  );
}
