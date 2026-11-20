import { useState, useMemo } from "react";
import { todayStr } from "../../features/habits/habitService";
import { isCalendarDate } from "../../features/calendar/calendarDates.mjs";

function shiftDate(dateStr, delta) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const TIME_SLOTS = ['오전', '오후', '저녁'];

function TaskRow({ task, onToggle, onDelete }) {
  return (
    <li className={`today-task-item ${task.completed ? 'today-task-done' : ''}`}>
      <input type="checkbox" className="today-checkbox" aria-label={`${task.title} 완료`}
        checked={task.completed} onChange={() => onToggle(task.id, task.completed)} />
      <span className="today-task-title">{task.title}</span>
      <button type="button" className="th-del" aria-label={`${task.title} 삭제`} onClick={() => onDelete(task.id)}>✕</button>
    </li>
  );
}

/* 시간대 한 칸: 항목이 없어도 항상 보여서 빈 시간대를 바로 알 수 있다. */
function SlotLane({ slot, items, date, onAdd, onToggle, onDelete }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const handleAdd = async (e) => {
    e.preventDefault();
    const value = title.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await onAdd({ title: value, dueDate: date, timeSlot: slot });
      setTitle("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`today-lane ${items.length === 0 ? 'today-lane-empty' : ''}`} aria-label={`${slot} 할 일`}>
      <h3 className="today-lane-label">{slot}<span>{items.length}</span></h3>
      {items.length > 0 && (
        <ul className="today-task-list">
          {items.map(t => <TaskRow key={t.id} task={t} onToggle={onToggle} onDelete={onDelete} />)}
        </ul>
      )}
      <form className="today-lane-add" onSubmit={handleAdd}>
        <input className="today-lane-input" placeholder="+ 추가" aria-label={`${slot} 할 일 추가`}
          value={title} readOnly={busy} onChange={e => setTitle(e.target.value)} />
      </form>
    </section>
  );
}

/* ── 하루 계획: 날짜 헤더 + 오전/오후/저녁 ── */
function TodayMain({ tasks, selectedDate, onAdd, onToggle, onDelete, onDateChange }) {
  const dateTasks = useMemo(() => tasks.filter(t => t.dueDate === selectedDate), [tasks, selectedDate]);
  const done  = dateTasks.filter(t => t.completed).length;
  const total = dateTasks.length;

  const grouped = useMemo(() => {
    const g = { '오전': [], '오후': [], '저녁': [], '기타': [] };
    for (const t of dateTasks) {
      const slot = TIME_SLOTS.includes(t.timeSlot) ? t.timeSlot : '기타';
      g[slot].push(t);
    }
    for (const slot of Object.keys(g)) {
      g[slot].sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
    }
    return g;
  }, [dateTasks]);

  const today = todayStr();
  const tomorrow = shiftDate(today, 1);
  const [year, month, day] = selectedDate.split('-').map(Number);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(year, month - 1, day).getDay()];
  const dateLabel = `${month}월 ${day}일 (${weekday})`;
  const relative = selectedDate === today ? '오늘' : selectedDate === tomorrow ? '내일' : null;

  return (
    <div className="today-main">
      <div className="today-date-row">
        <div className="today-date-left">
          <span className="today-block-title">📅 하루 계획</span>
          <h2 className="today-date-title">
            {relative ?? dateLabel}
            {relative && <span className="today-date-sub">&nbsp;·&nbsp;{dateLabel}</span>}
          </h2>
          {total > 0 && (
            <span className={`today-progress ${done === total ? 'today-all-done' : ''}`}>
              {done}/{total} 완료
            </span>
          )}
        </div>
        <div className="today-day-nav">
          <div className="today-quick-days" role="group" aria-label="빠른 날짜 이동">
            <button type="button" aria-pressed={selectedDate === today} onClick={() => onDateChange(today)}>오늘</button>
            <button type="button" aria-pressed={selectedDate === tomorrow} onClick={() => onDateChange(tomorrow)}>내일</button>
          </div>
          <input type="date" className="today-date-input" aria-label="계획 날짜" value={selectedDate}
            min="1000-01-01" max="9999-12-31"
            onChange={e => { if (isCalendarDate(e.target.value)) onDateChange(e.target.value); }} />
          <button type="button" className="day-nav-arrow" onClick={() => onDateChange(shiftDate(selectedDate, -1))} title="이전 날" aria-label="이전 날">‹</button>
          <button type="button" className="day-nav-arrow" onClick={() => onDateChange(shiftDate(selectedDate, 1))} title="다음 날" aria-label="다음 날">›</button>
        </div>
      </div>

      <div className="today-lanes">
        {TIME_SLOTS.map(slot => (
          <SlotLane key={`${selectedDate}-${slot}`} slot={slot} items={grouped[slot]} date={selectedDate}
            onAdd={onAdd} onToggle={onToggle} onDelete={onDelete} />
        ))}
      </div>

      {grouped['기타'].length > 0 && (
        <section className="today-lane-extra" aria-label="시간대 없는 할 일">
          <h3 className="today-lane-label">시간대 없음<span>{grouped['기타'].length}</span></h3>
          <ul className="today-task-list">
            {grouped['기타'].map(t => <TaskRow key={t.id} task={t} onToggle={onToggle} onDelete={onDelete} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

export default TodayMain;
