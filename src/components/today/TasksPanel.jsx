import { useState } from "react";
import { todayStr } from "../../features/habits/habitService";
import TodoItem from "./TodoItem";

/* ── 할 일 관리 팝업 ── */
// '할 일' 블럭에서 펼쳐 보여주는 기간. 이보다 먼 마감과 마감 없는 일은 '나중에'로 접는다.
const SOON_DAYS = 14;

function daysUntil(dueDate) {
  if (!dueDate) return null;
  return Math.round((new Date(dueDate) - new Date(todayStr())) / 86400000);
}

function dueDateLabel(dueDate) {
  const diff = daysUntil(dueDate);
  if (diff === null) return null;
  if (diff < 0)   return { text: `D+${-diff}`, cls: "due-overdue" };
  if (diff === 0) return { text: "D-Day",      cls: "due-today"   };
  if (diff === 1) return { text: "D-1",        cls: "due-soon"    };
  return           { text: `D-${diff}`,        cls: "due-normal"  };
}

function TaskPopup({ tasks, onClose, onAdd, onDelete }) {
  const [title,   setTitle]   = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState("");
  const undated = tasks.filter(t => !t.dueDate);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await onAdd({ title: title.trim(), dueDate: dueDate || null });
      setTitle(""); setDueDate("");
    } catch {
      setError("할 일을 추가하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
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
          {error && <p role="alert" className="habit-error">{error}</p>}
          {undated.length === 0 ? (
            <p className="today-block-empty" style={{ padding: '20px 0' }}>날짜 미지정 할 일이 없습니다</p>
          ) : (
            <ul className="task-list">
              {undated.map(t => <TodoItem key={t.id} todo={t} due={null} onDelete={onDelete} />)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function AllTasksBlock({ tasks, onDelete, onManage }) {
  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (!a.createdAt) return b.createdAt ? 1 : 0;
    if (!b.createdAt) return -1;
    return a.createdAt.seconds - b.createdAt.seconds
      || a.createdAt.nanoseconds - b.createdAt.nanoseconds;
  });
  const groups = { overdue: [], soon: [], later: [] };
  for (const t of sortedTasks) {
    const diff = daysUntil(t.dueDate);
    groups[diff === null || diff > SOON_DAYS ? 'later' : diff < 0 ? 'overdue' : 'soon'].push(t);
  }
  const list = items => (
    <ul className="task-list">
      {items.map(t => <TodoItem key={t.id} todo={t} due={dueDateLabel(t.dueDate)} onDelete={onDelete} />)}
    </ul>
  );
  const nearCount = groups.overdue.length + groups.soon.length;
  return (
    <div className="today-block todo-backlog">
      <div className="today-block-hdr">
        <span className="today-block-title">✅ 할 일 <span className="today-block-count">{tasks.length}</span></span>
        <button className="block-manage-btn" onClick={onManage}>관리</button>
      </div>
      {tasks.length === 0 ? (
        <p className="today-block-empty">할 일이 없습니다</p>
      ) : (
        <div className="todo-groups">
          {groups.overdue.length > 0 && <section className="todo-group todo-group-overdue" aria-label="지난 마감">
            <h3 className="todo-group-label">지난 마감 <span>{groups.overdue.length}</span></h3>
            {list(groups.overdue)}
          </section>}
          {groups.soon.length > 0 && <section className="todo-group" aria-label={`${SOON_DAYS}일 이내`}>
            <h3 className="todo-group-label">{SOON_DAYS}일 이내 <span>{groups.soon.length}</span></h3>
            {list(groups.soon)}
          </section>}
          {groups.later.length > 0 && <details className="todo-group todo-group-later" open={nearCount === 0}>
            <summary className="todo-group-label">나중에 <span>{groups.later.length}</span></summary>
            {list(groups.later)}
          </details>}
        </div>
      )}
    </div>
  );
}

export { TaskPopup, AllTasksBlock };
