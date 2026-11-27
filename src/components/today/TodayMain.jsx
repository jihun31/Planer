import { useState, useMemo } from "react";
import { todayStr } from "../../features/habits/habitService";
import { isCalendarDate } from "../../features/calendar/calendarDates.mjs";
import { addDays, isSkipped, planChecked, planHabits, planToggleValue } from "../../features/habits/habitCore.mjs";

function shiftDate(dateStr, delta) {
  return addDays(dateStr, delta);
}

const TIME_SLOTS = ['오전', '오후', '저녁'];
// 시간 흐름을 색으로: 오전 주황(해 뜰 때) → 오후 파랑(한낮) → 저녁 보라(밤)
const SLOT_STYLE = { '오전': { icon: '🌅', cls: 'lane-morning' }, '오후': { icon: '☀️', cls: 'lane-afternoon' }, '저녁': { icon: '🌙', cls: 'lane-evening' } };

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

/* 하루 계획에 고정한 습관: 체크하면 습관 기록(logs)에 바로 남아 습관 탭과 통계에도 같이 보인다. */
function HabitRow({ habit, date, onToggle, pending }) {
  const done = planChecked(habit, date);
  const skipped = isSkipped(habit, date);
  return (
    <li className={`today-task-item today-habit-item ${done ? 'today-task-done' : ''}`}>
      <input type="checkbox" className="today-checkbox" aria-label={`${habit.name} 완료`}
        checked={done} disabled={skipped || pending} onChange={() => onToggle(habit)} />
      <span className="today-task-title">{habit.emoji ? `${habit.emoji} ` : ''}{habit.name}</span>
      <span className="today-habit-tag">{skipped ? '쉬는 날' : '습관'}</span>
    </li>
  );
}

/* 시간대 한 칸: 항목이 없어도 항상 보여서 빈 시간대를 바로 알 수 있다.
   평소엔 '+ 추가' 글자만 보이고, 누르면 입력칸이 열린다. Enter 뒤에도 열려 있어 연달아 적을 수 있다. */
function SlotLane({ slot, items, habits = [], date, onAdd, onToggle, onDelete, onToggleHabit, pendingHabit }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => { setAdding(false); setTitle(""); setError(""); };
  const handleAdd = async (e) => {
    e.preventDefault();
    const value = title.trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    try {
      await onAdd({ title: value, dueDate: date, timeSlot: slot });
      setTitle("");
    } catch {
      setError("할 일을 추가하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };
  const { icon, cls } = SLOT_STYLE[slot];
  return (
    <section className={`today-lane ${cls}`} aria-label={`${slot} 할 일`}>
      <h3 className="today-lane-label"><span aria-hidden="true">{icon}</span>{slot}
        {items.length + habits.length > 0 && <span className="today-lane-count">{items.length + habits.length}</span>}</h3>
      {items.length + habits.length > 0 && (
        <ul className="today-task-list">
          {habits.map(h => <HabitRow key={`habit-${h.id}`} habit={h} date={date} onToggle={onToggleHabit} pending={pendingHabit === h.id} />)}
          {items.map(t => <TaskRow key={t.id} task={t} onToggle={onToggle} onDelete={onDelete} />)}
        </ul>
      )}
      {adding ? (
        <form className="today-lane-add" onSubmit={handleAdd}>
          <input className="today-lane-input" aria-label={`${slot} 할 일 추가`} placeholder="할 일 입력 후 Enter" autoFocus
            value={title} readOnly={busy} onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') close(); }}
            onBlur={() => { if (!title.trim() && !busy) close(); }} />
        </form>
      ) : (
        <button type="button" className="today-lane-add-btn" aria-label={`${slot} 할 일 추가`} onClick={() => setAdding(true)}>+ 추가</button>
      )}
      {error && <p role="alert" className="habit-error">{error}</p>}
    </section>
  );
}

/* ── 하루 계획: 날짜 헤더 + 오전/오후/저녁 ── */
function TodayMain({ tasks, habits = [], selectedDate, onAdd, onToggle, onDelete, onDateChange, onSetHabitLog }) {
  const dateTasks = useMemo(() => tasks.filter(t => t.dueDate === selectedDate), [tasks, selectedDate]);
  const slotHabits = useMemo(() => Object.fromEntries(TIME_SLOTS.map(slot => [slot, planHabits(habits, selectedDate, slot)])),
    [habits, selectedDate]);
  // 쉬는 날로 기록한 습관은 진행률에서 뺀다
  const countedHabits = TIME_SLOTS.flatMap(slot => slotHabits[slot]).filter(h => !isSkipped(h, selectedDate));
  const done  = dateTasks.filter(t => t.completed).length + countedHabits.filter(h => planChecked(h, selectedDate)).length;
  const total = dateTasks.length + countedHabits.length;

  const [pendingHabit, setPendingHabit] = useState(null);
  const [habitFailure, setHabitFailure] = useState('');
  const toggleHabit = async (habit) => {
    if (!onSetHabitLog || pendingHabit) return;
    setPendingHabit(habit.id);
    setHabitFailure('');
    try { await onSetHabitLog(habit.id, selectedDate, planToggleValue(habit, selectedDate)); }
    catch { setHabitFailure('습관 기록을 저장하지 못했어요. 연결 상태를 확인해 주세요.'); }
    finally { setPendingHabit(null); }
  };

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
          <SlotLane key={`${selectedDate}-${slot}`} slot={slot} items={grouped[slot]} habits={slotHabits[slot]} date={selectedDate}
            onAdd={onAdd} onToggle={onToggle} onDelete={onDelete} onToggleHabit={toggleHabit} pendingHabit={pendingHabit} />
        ))}
      </div>
      {habitFailure && <p role="alert" className="habit-error">{habitFailure}</p>}

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
