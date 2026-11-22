import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DAY_START_HOUR, plannerDate } from '../../features/planner/scheduleTime.mjs';

const SLOT_ORDER = new Map([['오전', 0], ['오후', 1], ['저녁', 2]]);
const slotIndex = task => SLOT_ORDER.get(task.timeSlot) ?? SLOT_ORDER.size;

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

function ReminderItem({ task, measuring, pending, onToggle }) {
  const details = <>
    {task.timeSlot && <span className="task-reminder-slot">{task.timeSlot}</span>}
    {measuring ? <span className="task-reminder-check" />
      : <input type="checkbox" className="task-reminder-check" aria-label={task.title + ' 완료'}
          checked={Boolean(task.completed)} disabled={pending} onChange={() => onToggle(task)} />}
    <span className="task-reminder-title" title={measuring ? undefined : task.title}>{task.title}</span>
  </>;
  return measuring ? <span className="task-reminder-item">{details}</span>
    : <label className="task-reminder-item">{details}</label>;
}

export default function TaskReminder({ tasks, onToggle }) {
  const date = useReminderDate();
  const items = useMemo(() => tasks.filter(task => task.dueDate === date)
    .sort((a, b) => slotIndex(a) - slotIndex(b) || (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0)), [tasks, date]);

  const expandedId = useId();
  const [expandedDate, setExpandedDate] = useState(null);
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [errorDate, setErrorDate] = useState(null);
  const measureRef = useRef(null);
  const count = useFittingCount(measureRef, items);
  const extra = items.slice(count);
  const expanded = expandedDate === date && extra.length > 0;

  const toggle = async task => {
    setPendingIds(ids => new Set(ids).add(task.id));
    setErrorDate(null);
    try {
      await onToggle(task.id, Boolean(task.completed));
    } catch {
      setErrorDate(date);
    } finally {
      setPendingIds(ids => {
        const next = new Set(ids);
        next.delete(task.id);
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
          {items.map(task => <ReminderItem key={task.id} task={task} measuring />)}
          <span className="task-reminder-more">+<span>{items.length}</span>개 더 보기</span>
        </div>
        <div className="task-reminder-line">
          {items.slice(0, count).map(task => <ReminderItem key={task.id} task={task}
            pending={pendingIds.has(task.id)} onToggle={toggle} />)}
          {extra.length > 0 && <button type="button" className="task-reminder-more"
            aria-expanded={expanded} aria-controls={expandedId} onClick={() => setExpandedDate(expanded ? null : date)}>
            {expanded ? '접기' : '+' + extra.length + '개 더 보기'}
          </button>}
        </div>
        <div className="task-reminder-extra" id={expandedId} hidden={!expanded}>
          {expanded && extra.map(task => <ReminderItem key={task.id} task={task}
            pending={pendingIds.has(task.id)} onToggle={toggle} />)}
        </div>
      </>}
      {errorDate === date && <p className="task-reminder-error" role="alert">할 일 상태를 저장하지 못했습니다. 다시 시도해 주세요.</p>}
    </section>
  );
}
