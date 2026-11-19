import { useState } from "react";
import { todayStr } from "../../features/habits/habitService";
import TodoItem from "./TodoItem";

/* ── 할 일 관리 팝업 ── */
function dueDateLabel(dueDate) {
  if (!dueDate) return null;
  const diff = Math.round((new Date(dueDate) - new Date(todayStr())) / 86400000);
  if (diff < 0)   return { text: `D+${-diff}`, cls: "due-overdue" };
  if (diff === 0) return { text: "D-Day",      cls: "due-today"   };
  if (diff === 1) return { text: "D-1",        cls: "due-soon"    };
  return           { text: `D-${diff}`,        cls: "due-normal"  };
}

function TaskPopup({ tasks, onClose, onAdd, onDelete }) {
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
          {sortedTasks.map(t => <TodoItem key={t.id} todo={t} due={dueDateLabel(t.dueDate)} onDelete={onDelete} />)}
        </ul>
      )}
    </div>
  );
}

export { TaskPopup, AllTasksBlock };
