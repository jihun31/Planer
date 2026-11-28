import { useState } from "react";
import { updateTodo } from "../../features/todos/todoService";

// One todo row with inline editing of its title and due date (Esc cancels).
export default function TodoItem({ todo, due, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const [date, setDate] = useState(todo.dueDate || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const start = () => { setTitle(todo.title); setDate(todo.dueDate || ''); setError(''); setEditing(true); };
  const save = async event => {
    event.preventDefault();
    const nextTitle = title.trim(), nextDate = date || null;
    if (!nextTitle || busy) return;
    if (nextTitle === todo.title && nextDate === (todo.dueDate || null)) { setEditing(false); return; }
    setBusy(true); setError('');
    try {
      await updateTodo(todo.id, { title: nextTitle, dueDate: nextDate });
      setEditing(false);
    } catch {
      setError('할 일을 수정하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };
  if (editing) {
    return (
      <li className="task-item task-editing">
        <form className="task-edit-form" onSubmit={save}
          onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); setEditing(false); } }}>
          <input className="today-add-input task-edit-title" value={title} autoFocus aria-label="할 일 내용"
            disabled={busy} onChange={event => setTitle(event.target.value)} />
          <input className="form-input-date" type="date" value={date} aria-label="마감일"
            disabled={busy} onChange={event => setDate(event.target.value)} />
          <button type="submit" className="task-edit-save" disabled={busy || !title.trim()}>{busy ? '...' : '저장'}</button>
          <button type="button" className="task-edit-cancel" disabled={busy} onClick={() => setEditing(false)}>취소</button>
        </form>
        {error && <p role="alert" className="task-edit-error">{error}</p>}
      </li>
    );
  }
  return (
    <li className={`task-item ${todo.completed ? 'task-done' : ''}`}>
      <input type="checkbox" className="task-checkbox" checked={todo.completed}
        onChange={() => onDelete(todo.id)} aria-label={`${todo.title} 완료 후 삭제`} />
      <span className="task-title">{todo.title}</span>
      {due && <span className={`task-due ${due.cls}`}>{due.text}</span>}
      <button type="button" className="th-edit" title="수정" aria-label={`${todo.title} 수정`} onClick={start}>✎</button>
      <button type="button" className="th-del" title="삭제" aria-label={`${todo.title} 삭제`} onClick={() => onDelete(todo.id)}>✕</button>
    </li>
  );
}
