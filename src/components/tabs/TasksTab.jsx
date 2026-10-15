import { useState, useMemo, useEffect } from "react";
import GoalCard, { periodLabel } from "../GoalCard";
import { GOAL_COLORS } from "../../features/goals/goalService";
import { todayStr } from "../../features/habits/habitService";

function getDaysRemaining(sub) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let deadline;
  if (sub.type === "month") {
    deadline = new Date(sub.year, sub.month, 0);
  } else {
    const lastDay = sub.weekOfMonth < 5
      ? sub.weekOfMonth * 7
      : new Date(sub.year, sub.month, 0).getDate();
    deadline = new Date(sub.year, sub.month - 1, lastDay);
  }
  deadline.setHours(0, 0, 0, 0);
  return Math.round((deadline - now) / 86400000);
}

function DBadge({ days }) {
  if (days < 0)   return <span className="d-badge d-overdue">D+{-days}</span>;
  if (days === 0) return <span className="d-badge d-today">D-Day</span>;
  if (days <= 3)  return <span className="d-badge d-urgent">D-{days}</span>;
  if (days <= 7)  return <span className="d-badge d-soon">D-{days}</span>;
  return                 <span className="d-badge d-future">D-{days}</span>;
}

function shiftDate(dateStr, delta) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* ── 목표 관리 팝업 ── */
function GoalAddInline({ onAdd, count }) {
  const [title, setTitle]   = useState("");
  const [color, setColor]   = useState(GOAL_COLORS[count % GOAL_COLORS.length]);
  const [busy,  setBusy]    = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    await onAdd(title.trim(), color);
    setTitle("");
    setColor(GOAL_COLORS[(count + 1) % GOAL_COLORS.length]);
    setBusy(false);
  };

  return (
    <form className="goal-add-inline" onSubmit={handleSubmit}>
      <div className="goal-add-colors">
        {GOAL_COLORS.map((c) => (
          <button key={c} type="button"
            className={`goal-color-dot ${c === color ? 'gcd-active' : ''}`}
            style={{ background: c, boxShadow: c === color ? `0 0 0 2px #fff, 0 0 0 3px ${c}` : 'none' }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <div className="goal-add-inline-row">
        <input className="form-input" placeholder="장기 목표 이름 추가"
          value={title} onChange={(e) => setTitle(e.target.value)}
          style={{ borderColor: color + '80' }} required />
        <button className="btn btn-login" type="submit" disabled={busy}
          style={{ background: color, borderColor: color, whiteSpace: 'nowrap' }}>
          {busy ? "..." : "+ 추가"}
        </button>
      </div>
    </form>
  );
}

function CompletedSectionMini({ goals, subGoals, onDelete, onToggle }) {
  const [open, setOpen] = useState(false);
  const completedSubs = subGoals.filter(s => s.completed);
  const grouped = goals.reduce((acc, goal) => {
    const items = completedSubs.filter(s => s.goalId === goal.id);
    if (items.length > 0) acc.push({ goal, items });
    return acc;
  }, []);
  if (grouped.length === 0) return null;
  return (
    <div className="completed-section">
      <button className="completed-toggle" onClick={() => setOpen(v => !v)}>
        <span>✅ 완료된 목표 <span className="completed-count">{completedSubs.length}</span></span>
        <span className="toggle-arrow">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="completed-list">
          {grouped.map(({ goal, items }) => {
            const color = goal.color || GOAL_COLORS[0];
            return (
              <div key={goal.id} className="completed-group">
                <p className="completed-goal-label" style={{ color }}>
                  <span className="completed-goal-dot" style={{ background: color }} />{goal.title}
                </p>
                <ul className="subgoal-list">
                  {items.map(sub => (
                    <li key={sub.id} className="subgoal-item subgoal-done">
                      <input type="checkbox" className="subgoal-checkbox" style={{ accentColor: color }}
                        checked onChange={() => onToggle(sub.id, sub.completed)} />
                      <span className="subgoal-type-badge" style={{ background: color + '20', color }}>
                        {sub.type === "month" ? "월" : "주"}
                      </span>
                      <span className="subgoal-period">{periodLabel(sub)}</span>
                      <span className="subgoal-title">{sub.title}</span>
                      <button className="subgoal-delete" onClick={() => onDelete(sub.id)}>✕</button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GoalPopup({ goals, subGoals, onClose, onAddGoal, onDeleteGoal, onUpdateColor, onUpdateTitle, onAddSubGoal, onDeleteSubGoal, onToggleSubGoal }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <span className="modal-ttl">🎯 목표 관리</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-bdy">
          <GoalAddInline onAdd={onAddGoal} count={goals.length} />
          {goals.length === 0 ? (
            <p className="today-block-empty" style={{ padding: '24px 0' }}>목표를 추가해보세요</p>
          ) : (
            <div className="modal-goal-list">
              {goals.map(goal => (
                <GoalCard key={goal.id} goal={goal}
                  subGoals={subGoals.filter(s => s.goalId === goal.id && !s.completed)}
                  onDeleteGoal={onDeleteGoal} onUpdateColor={onUpdateColor}
                  onUpdateTitle={onUpdateTitle} onAddSubGoal={onAddSubGoal}
                  onDeleteSubGoal={onDeleteSubGoal} onToggleSubGoal={onToggleSubGoal}
                />
              ))}
            </div>
          )}
          <CompletedSectionMini goals={goals} subGoals={subGoals}
            onDelete={onDeleteSubGoal} onToggle={onToggleSubGoal} />
        </div>
      </div>
    </div>
  );
}

/* ── 할 일 관리 팝업 ── */
function dueDateLabel(dueDate) {
  if (!dueDate) return null;
  const diff = Math.round((new Date(dueDate) - new Date(todayStr())) / 86400000);
  if (diff < 0)   return { text: `D+${-diff}`, cls: "due-overdue" };
  if (diff === 0) return { text: "D-Day",      cls: "due-today"   };
  if (diff === 1) return { text: "D-1",        cls: "due-soon"    };
  return           { text: `D-${diff}`,        cls: "due-normal"  };
}

function TaskPopup({ tasks, onClose, onAdd, onToggle, onDelete }) {
  const [title,   setTitle]   = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy,    setBusy]    = useState(false);
  const undated = tasks.filter(t => !t.dueDate);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    await onAdd({ title: title.trim(), dueDate: dueDate || null });
    setTitle(""); setDueDate("");
    setBusy(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <span className="modal-ttl">✅ 할 일 관리</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-bdy">
          <form className="task-popup-form" onSubmit={handleAdd}>
            <input className="today-add-input" placeholder="할 일 추가..."
              value={title} onChange={e => setTitle(e.target.value)} autoFocus />
            <input className="form-input-date" type="date"
              value={dueDate} onChange={e => setDueDate(e.target.value)} />
            <button className="today-add-btn" type="submit" disabled={busy || !title.trim()}>
              + 추가
            </button>
          </form>
          {undated.length === 0 ? (
            <p className="today-block-empty" style={{ padding: '20px 0' }}>날짜 미지정 할 일이 없습니다</p>
          ) : (
            <ul className="task-list">
              {undated.map(t => (
                <li key={t.id} className={`task-item ${t.completed ? 'task-done' : ''}`}>
                  <input type="checkbox" className="task-checkbox"
                    checked={t.completed} onChange={() => onToggle(t.id, t.completed)} />
                  <span className="task-title">{t.title}</span>
                  <button className="th-del" onClick={() => onDelete(t.id)}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 오른쪽 사이드바 블록 ── */
function DeadlineGoalsBlock({ goals, subGoals, onManage }) {
  const goalMap = Object.fromEntries(goals.map(g => [g.id, g]));
  const sorted = subGoals
    .filter(s => !s.completed)
    .map(s => ({ ...s, daysLeft: getDaysRemaining(s) }))
    .sort((a, b) => {
      if (a.year === b.year && a.month === b.month) {
        return (a.createdAt?.seconds ?? Infinity) - (b.createdAt?.seconds ?? Infinity);
      }
      return a.daysLeft - b.daysLeft;
    })
    .slice(0, 8);
  const groups = [
    { label: '월간', items: sorted.filter(sub => sub.type === 'month') },
    { label: '주간', items: sorted.filter(sub => sub.type !== 'month') },
  ].filter(group => group.items.length > 0);

  return (
    <div className="today-block">
      <div className="today-block-hdr">
        <span className="today-block-title">⏰ 월별 목표</span>
        <button className="block-manage-btn" onClick={onManage}>관리</button>
      </div>
      {sorted.length === 0 ? (
        <p className="today-block-empty">세부 목표가 없습니다</p>
      ) : (
        <div className="goal-period-groups">
          {groups.map(group => (
            <section key={group.label} className="goal-period-group">
              <h3 className="goal-period-label">{group.label} <span>{group.items.length}</span></h3>
              <ul className="sidebar-list">
                {group.items.map(sub => {
                  const goal = goalMap[sub.goalId];
                  const color = goal?.color || GOAL_COLORS[0];
                  return (
                    <li key={sub.id} className="sidebar-item">
                      <span className="sidebar-goal-dot" style={{ background: color }} />
                      <DBadge days={sub.daysLeft} />
                      <div className="sidebar-item-body">
                        <p className="sidebar-sub-title">{sub.title}</p>
                        <p className="sidebar-meta" style={{ color }}>{goal?.title ?? "—"} · {periodLabel(sub)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function AllTasksBlock({ tasks, onToggle, onDelete, onManage }) {
  return (
    <div className="today-block">
      <div className="today-block-hdr">
        <span className="today-block-title">✅ 할 일</span>
        <button className="block-manage-btn" onClick={onManage}>관리</button>
      </div>
      {tasks.length === 0 ? (
        <p className="today-block-empty">할 일이 없습니다</p>
      ) : (
        <ul className="task-list" style={{ marginTop: 4 }}>
          {[...tasks].sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
            if (!a.createdAt) return b.createdAt ? 1 : 0;
            if (!b.createdAt) return -1;
            return a.createdAt.seconds - b.createdAt.seconds
              || a.createdAt.nanoseconds - b.createdAt.nanoseconds;
          }).map(t => {
            const due = dueDateLabel(t.dueDate);
            return (
              <li key={t.id} className={`task-item ${t.completed ? 'task-done' : ''}`}>
                <input type="checkbox" className="task-checkbox"
                  checked={t.completed} onChange={() => onToggle(t.id, t.completed)} />
                <span className="task-title">{t.title}</span>
                {due && <span className={`task-due ${due.cls}`}>{due.text}</span>}
                <button className="th-del" onClick={() => onDelete(t.id)}>✕</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PriorityNotesBlock({ data }) {
  const { notes, loading, error, addNote, updateNote, deleteNote, moveNote } = data;
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);

  useEffect(() => {
    if (!openMenuId) return;
    const closeOutside = event => {
      if (!event.target.closest('.priority-menu-wrap')) setOpenMenuId(null);
    };
    const closeOnEscape = event => {
      if (event.key === 'Escape') setOpenMenuId(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenuId]);

  const perform = async action => {
    if (busy) return false;
    setBusy(true);
    setActionError('');
    try {
      await action();
      return true;
    } catch {
      setActionError('우선순위를 저장하지 못했습니다. 연결 상태와 Firebase 규칙을 확인해 주세요.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async event => {
    event.preventDefault();
    const value = text.trim();
    if (value && await perform(() => addNote(value))) setText('');
  };

  const handleEdit = async event => {
    event.preventDefault();
    const value = editingText.trim();
    if (value && await perform(() => updateNote(editingId, value))) setEditingId(null);
  };

  return (
    <section className="today-block priority-block" aria-label="우선순위">
      <div className="today-block-hdr">
        <span className="today-block-title">📝 우선순위</span>
      </div>
      <form className="priority-add-form" onSubmit={handleAdd}>
        <input className="today-add-input" value={text} onChange={event => setText(event.target.value)}
          placeholder="우선순위 메모 추가" aria-label="우선순위 메모" />
        <button className="today-add-btn" type="submit" disabled={busy || !text.trim()}>추가</button>
      </form>
      {(error || actionError) && <p className="priority-error" role="alert">
        {actionError || '우선순위를 불러오지 못했습니다. Firebase 규칙을 확인해 주세요.'}
      </p>}
      {loading ? (
        <p className="today-block-empty">우선순위를 불러오는 중…</p>
      ) : notes.length === 0 ? (
        <p className="today-block-empty">첫 번째 우선순위를 적어보세요</p>
      ) : (
        <ol className="priority-list">
          {notes.map((note, index) => (
            <li key={note.id} className="priority-item">
              <span className="priority-rank">{index + 1}순위</span>
              {editingId === note.id ? (
                <form className="priority-edit-form" onSubmit={handleEdit}>
                  <input className="priority-edit-input" value={editingText}
                    onChange={event => setEditingText(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Escape') setEditingId(null); }}
                    aria-label={`${index + 1}순위 내용 수정`} autoFocus />
                  <button type="submit" className="priority-action" disabled={busy || !editingText.trim()} aria-label="수정 저장">✓</button>
                  <button type="button" className="priority-action" onClick={() => setEditingId(null)} aria-label="수정 취소">✕</button>
                </form>
              ) : (
                <>
                  <span className="priority-text">{note.text}</span>
                  <div className="priority-menu-wrap">
                    <button type="button" className="priority-menu-trigger" disabled={busy}
                      aria-label={`${index + 1}순위 작업`} aria-expanded={openMenuId === note.id}
                      onClick={() => setOpenMenuId(openMenuId === note.id ? null : note.id)}>⋯</button>
                    {openMenuId === note.id && <div className="priority-menu" role="group" aria-label={`${index + 1}순위 작업`}>
                      <button type="button" disabled={busy || index === 0}
                        onClick={() => { setOpenMenuId(null); perform(() => moveNote(note.id, -1)); }}>↑ 위로 이동</button>
                      <button type="button" disabled={busy || index === notes.length - 1}
                        onClick={() => { setOpenMenuId(null); perform(() => moveNote(note.id, 1)); }}>↓ 아래로 이동</button>
                      <button type="button" disabled={busy}
                        onClick={() => { setOpenMenuId(null); setEditingId(note.id); setEditingText(note.text); }}>수정</button>
                      <button type="button" className="priority-menu-delete" disabled={busy}
                        onClick={() => { setOpenMenuId(null); perform(() => deleteNote(note.id)); }}>삭제</button>
                    </div>}
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const TIME_SLOTS = ['오전', '오후', '저녁'];

/* ── 왼쪽 메인 영역 ── */
function TodayMain({ tasks, selectedDate, onAdd, onToggle, onDelete, onDateChange }) {
  const [title,    setTitle]    = useState("");
  const [timeSlot, setTimeSlot] = useState("오전");
  const [busy,     setBusy]     = useState(false);

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

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    await onAdd({ title: title.trim(), dueDate: selectedDate, timeSlot });
    setTitle("");
    setBusy(false);
  };

  const [year, month, day] = selectedDate.split('-').map(Number);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(year, month - 1, day).getDay()];
  const dateLabel = `${month}월 ${day}일 (${weekday})`;
  const isToday = selectedDate === todayStr();

  return (
    <div className="today-main">
      <div className="today-block-hdr today-main-hdr">
        <span className="today-block-title">📅 날짜별 할 일</span>
      </div>
      <div className="today-date-row">
        <div className="today-date-left">
          <h2 className="today-date-title">
            {isToday ? '오늘' : dateLabel}
            {isToday && <span className="today-date-sub">&nbsp;·&nbsp;{dateLabel}</span>}
          </h2>
          {total > 0 && (
            <span className={`today-progress ${done === total ? 'today-all-done' : ''}`}>
              {done}/{total} 완료
            </span>
          )}
        </div>
        <div className="today-day-nav">
          <button className="day-nav-arrow" onClick={() => onDateChange(shiftDate(selectedDate, -1))} title="이전 날">‹</button>
          <button className="day-nav-arrow" onClick={() => onDateChange(shiftDate(selectedDate, 1))} title="다음 날">›</button>
        </div>
      </div>

      <div className="today-slot-btns">
        {TIME_SLOTS.map(s => (
          <button key={s} type="button"
            className={`today-slot-btn ${timeSlot === s ? 'slot-active' : ''}`}
            onClick={() => setTimeSlot(s)}>
            {s}
          </button>
        ))}
      </div>

      <form className="today-add-form" onSubmit={handleAdd}>
        <input
          className="today-add-input"
          placeholder={`${timeSlot} 할 일 추가...`}
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
        <button className="today-add-btn" type="submit" disabled={busy || !title.trim()}>
          + 추가
        </button>
      </form>

      {dateTasks.length === 0 ? (
        <div className="today-empty">
          <span>📝</span>
          <p>이 날의 할 일이 없습니다</p>
          <p className="today-empty-hint">위 입력창에서 추가하거나<br />날짜 화살표로 이동하세요.</p>
        </div>
      ) : (
        <div className="today-grouped-list">
          {[...TIME_SLOTS, '기타'].map(slot => {
            const items = grouped[slot];
            if (!items || items.length === 0) return null;
            return (
              <div key={slot} className="today-slot-group">
                <p className="today-slot-label">{slot === '기타' ? '기타' : slot}</p>
                <ul className="today-task-list">
                  {items.map(t => (
                    <li key={t.id} className={`today-task-item ${t.completed ? 'today-task-done' : ''}`}>
                      <input type="checkbox" className="today-checkbox"
                        checked={t.completed} onChange={() => onToggle(t.id, t.completed)} />
                      <span className="today-task-title">{t.title}</span>
                      <button className="th-del" onClick={() => onDelete(t.id)}>✕</button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── 탭 루트 ── */
function TodayTab({ tasks: tasksData, todos: todosData, goalsData, priorityData, todayLayout = 'balanced' }) {
  const { tasks, addTask, toggleTask, deleteTask } = tasksData;
  const { todos, addTodo, toggleTodo, deleteTodo } = todosData;
  const { goals = [], subGoals = [], addGoal, deleteGoal, updateGoalColor, updateGoalTitle, addSubGoal, deleteSubGoal, toggleSubGoal } = goalsData;

  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [goalPopup,    setGoalPopup]    = useState(false);
  const [taskPopup,    setTaskPopup]    = useState(false);

  return (
    <div className={`today-layout today-layout-${todayLayout}`}>
      <TodayMain
        tasks={tasks} selectedDate={selectedDate}
        onAdd={addTask} onToggle={toggleTask} onDelete={deleteTask}
        onDateChange={setSelectedDate}
      />

      <div className="today-middle">
        <AllTasksBlock tasks={todos} onToggle={toggleTodo} onDelete={deleteTodo} onManage={() => setTaskPopup(true)} />
      </div>

      <div className="today-right">
        <PriorityNotesBlock data={priorityData} />
        <DeadlineGoalsBlock goals={goals} subGoals={subGoals} onManage={() => setGoalPopup(true)} />
      </div>

      {goalPopup && (
        <GoalPopup
          goals={goals} subGoals={subGoals}
          onClose={() => setGoalPopup(false)}
          onAddGoal={addGoal} onDeleteGoal={deleteGoal}
          onUpdateColor={updateGoalColor} onUpdateTitle={updateGoalTitle}
          onAddSubGoal={addSubGoal} onDeleteSubGoal={deleteSubGoal}
          onToggleSubGoal={toggleSubGoal}
        />
      )}

      {taskPopup && (
        <TaskPopup
          tasks={todos}
          onClose={() => setTaskPopup(false)}
          onAdd={addTodo} onToggle={toggleTodo} onDelete={deleteTodo}
        />
      )}
    </div>
  );
}

export default TodayTab;
