import { useState, useEffect } from "react";

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

export default PriorityNotesBlock;
