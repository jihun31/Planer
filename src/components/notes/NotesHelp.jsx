import { useEffect, useId, useRef, useState } from 'react';

export function NotesHelp() {
  const [open,setOpen] = useState(false);
  const panel = useRef(null);
  const button = useRef(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = event => {
      if (!button.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false);
    };
    const escape = event => {
      if (event.key === 'Escape') {event.preventDefault();setOpen(false);button.current?.focus();}
    };
    document.addEventListener('pointerdown',outside,true);
    document.addEventListener('keydown',escape);
    return () => {
      document.removeEventListener('pointerdown',outside,true);
      document.removeEventListener('keydown',escape);
    };
  },[open]);
  return <div className="notes-help">
    <button ref={button} type="button" className="notes-help-button" aria-label="메모 단축키"
      title="메모 단축키" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>단축키</button>
    {open && <div ref={panel} id={panelId} className="notes-help-panel" role="region" aria-label="메모 사용법">
      <ol>
        <li>글자를 드래그하면 서식 메뉴가 열립니다.</li>
        <li>폴더는 드래그로 순서를 바꾸고, 우클릭으로 삭제합니다.</li>
        <li>서식 메뉴에서 각 서식의 단축키를 확인할 수 있습니다.</li>
        <li>/를 입력하면 제목·인용·구분선 등이 표시됩니다.</li>
        <li>리스트는 '-', 구분선은 '---'를 입력해 사용할 수 있습니다.</li>
      </ol>
    </div>}
  </div>;
}
