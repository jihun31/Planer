import { useState } from "react";
import PriorityNotesBlock from "./PriorityNotesBlock";

// 오늘 탭 맨 위의 한 줄: 1순위만 보여주고, 전체 편집은 팝업에서 한다.
export default function PriorityBar({ data }) {
  const [open, setOpen] = useState(false);
  const { notes, loading, error } = data;
  const top = notes[0];
  return (
    <>
      <div className="priority-bar" role="region" aria-label="1순위">
        <span className="priority-bar-pin" aria-hidden="true">📌</span>
        {loading ? <span className="priority-bar-muted">우선순위를 불러오는 중…</span>
          : error ? <span className="priority-bar-muted">우선순위를 불러오지 못했습니다</span>
          : top ? <><span className="priority-bar-rank">1순위</span><span className="priority-bar-text">{top.text}</span></>
          : <span className="priority-bar-muted">우선순위를 정해 보세요</span>}
        <button type="button" className="block-manage-btn priority-bar-btn" onClick={() => setOpen(true)}>
          {notes.length > 1 ? `전체 ${notes.length}개` : '관리'}
        </button>
      </div>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-box priority-modal" onClick={e => e.stopPropagation()}>
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
