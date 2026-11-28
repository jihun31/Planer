import { useEffect, useState } from "react";
import PriorityNotesBlock from "./PriorityNotesBlock";

// 오늘 탭 맨 위의 한 줄: 2순위까지만 보여주고, 전체 편집은 팝업에서 한다.
const SHOWN = 2;
export default function PriorityBar({ data }) {
  const [open, setOpen] = useState(false);
  const { notes, loading, error } = data;
  const shown = notes.slice(0, SHOWN);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);
  return (
    <>
      <div className="priority-bar" role="region" aria-label="우선순위">
        <span className="priority-bar-pin" aria-hidden="true">📌</span>
        {loading ? <span className="priority-bar-muted">우선순위를 불러오는 중…</span>
          : error ? <span className="priority-bar-muted">우선순위를 불러오지 못했습니다</span>
          : shown.length ? <ol className="priority-bar-list">{shown.map((note, index) => (
              <li key={note.id} className="priority-bar-item">
                <span className={`priority-bar-rank ${index === 0 ? 'is-first' : ''}`}>{index + 1}순위</span>
                <span className="priority-bar-text">{note.text}</span>
              </li>))}</ol>
          : <span className="priority-bar-muted">우선순위를 정해 보세요</span>}
        <button type="button" className="block-manage-btn priority-bar-btn" onClick={() => setOpen(true)}>
          {notes.length > SHOWN ? `전체 ${notes.length}개` : '관리'}
        </button>
      </div>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-box priority-modal" role="dialog" aria-modal="true" aria-label="우선순위" onClick={e => e.stopPropagation()}>
            <div className="modal-hdr">
              <span className="modal-ttl">📝 우선순위</span>
              <button type="button" className="modal-close" aria-label="닫기" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="modal-bdy">
              <PriorityNotesBlock data={data} embedded />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
