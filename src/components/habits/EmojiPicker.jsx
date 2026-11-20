import { useEffect, useRef, useState } from 'react';

// 습관에 자주 쓰는 이모지. 목록에 없으면 아래 칸에 직접 넣을 수 있다.
export const EMOJI_GROUPS = [
  ['운동·건강', ['🏃', '🚶', '🏋️', '🧘', '🚴', '🏊', '🤸', '💪', '🦷', '💊', '😴', '🛌']],
  ['먹고 마시기', ['💧', '🥤', '☕', '🍵', '🥗', '🍎', '🥦', '🍳', '🚭', '🍺']],
  ['공부·일', ['📚', '📖', '✍️', '📝', '💻', '🧠', '🗣️', '🎯', '📅', '⏰']],
  ['마음·생활', ['🙏', '😊', '📓', '🌱', '🧹', '🛁', '🧺', '💰', '📵', '🌙']],
  ['취미', ['🎸', '🎹', '🎨', '📷', '🧩', '🎮', '🪴', '🐶']],
];

export default function EmojiPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!wrap.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const pick = emoji => { onChange(emoji); setOpen(false); setCustom(''); };

  return <div className="habit-emoji-picker" ref={wrap}
    onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); } }}>
    <button type="button" className={`habit-emoji-btn ${value ? '' : 'empty'}`} aria-haspopup="dialog" aria-expanded={open}
      aria-label={value ? `이모지 ${value} 바꾸기` : '이모지 고르기'} title="이모지 고르기" onClick={() => setOpen(v => !v)}>
      {value || '＋'}
    </button>
    {open && <div className="habit-emoji-pop" role="dialog" aria-label="이모지 고르기">
      {EMOJI_GROUPS.map(([label, list]) => <div key={label} className="habit-emoji-group">
        <span className="habit-emoji-group-label">{label}</span>
        <div className="habit-emoji-grid">
          {list.map(emoji => <button key={emoji} type="button" className={`habit-emoji-opt ${emoji === value ? 'on' : ''}`}
            aria-label={emoji} aria-pressed={emoji === value} onClick={() => pick(emoji)}>{emoji}</button>)}
        </div>
      </div>)}
      <div className="habit-emoji-custom">
        <input value={custom} maxLength={8} placeholder="직접 입력 (Win + .)" aria-label="이모지 직접 입력"
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (custom.trim()) pick(custom.trim()); } }} />
        <button type="button" className="block-manage-btn" disabled={!custom.trim()} onClick={() => pick(custom.trim())}>넣기</button>
        {value && <button type="button" className="block-manage-btn" onClick={() => pick('')}>없애기</button>}
      </div>
    </div>}
  </div>;
}
