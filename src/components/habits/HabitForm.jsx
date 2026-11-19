import { useState } from 'react';
import { NAME_MAX, TEXT_MAX, WEEKDAY_LABELS, WEEK_ORDER, normalizeHabit, startSuggestions } from '../../features/habits/habitCore.mjs';

// 습관 추가·수정 창. "[이미 하는 일] 하고 나서 → [작은 행동]" 형태로 받는다(Fogg의 앵커, Gollwitzer의 if-then 계획).
export default function HabitForm({ habit, today, onSave, onClose }) {
  const [form, setForm] = useState(() => ({
    name: habit?.name ?? '',
    emoji: habit?.emoji ?? '',
    anchor: habit?.anchor ?? '',
    tinyVersion: habit?.tinyVersion ?? '',
    type: habit?.schedule?.type ?? 'weekly',
    count: habit?.schedule?.count ?? 3,
    days: habit?.schedule?.days ?? [],
    startDate: habit?.startDate ?? today,
  }));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const result = normalizeHabit({ ...form, schedule: { type: form.type, count: Number(form.count), days: form.days } });
  const toggleDay = day => set('days', form.days.includes(day) ? form.days.filter(d => d !== day) : [...form.days, day]);

  const submit = async event => {
    event.preventDefault();
    if (result.error || busy) return;
    setBusy(true);
    setFailure('');
    try { await onSave(result.value); onClose(); }
    catch { setFailure('습관을 저장하지 못했어요. 연결 상태를 확인해 주세요.'); setBusy(false); }
  };

  return <div className="modal-overlay" onClick={onClose}>
    <form className="modal-box habit-form" onClick={e => e.stopPropagation()} onSubmit={submit}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal-hdr">
        <span className="modal-ttl">{habit ? '습관 수정' : '🔁 새 습관'}</span>
        <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="modal-bdy">
        <label className="habit-field">
          <span>무엇을 할까요?</span>
          <div className="habit-name-row">
            <input className="today-add-input habit-emoji-input" value={form.emoji} maxLength={8} placeholder="🏃"
              aria-label="이모지" onChange={e => set('emoji', e.target.value)} />
            <input className="today-add-input" value={form.name} maxLength={NAME_MAX} placeholder="예: 운동 30분" autoFocus
              aria-label="습관 이름" onChange={e => set('name', e.target.value)} />
          </div>
        </label>

        <label className="habit-field">
          <span>언제 할까요? <em>이미 매일 하는 일 뒤에 붙이면 잊지 않아요</em></span>
          <input className="today-add-input" value={form.anchor} maxLength={TEXT_MAX} placeholder="예: 아침에 커피를 마신 뒤"
            aria-label="언제 할지" onChange={e => set('anchor', e.target.value)} />
        </label>

        <label className="habit-field">
          <span>최소 버전 <em>바쁜 날엔 이것만 해도 한 것으로 쳐요</em></span>
          <input className="today-add-input" value={form.tinyVersion} maxLength={TEXT_MAX} placeholder="예: 운동복 갈아입기"
            aria-label="최소 버전" onChange={e => set('tinyVersion', e.target.value)} />
        </label>

        {(form.anchor.trim() || form.name.trim()) && <p className="habit-preview">
          {form.anchor.trim() || '…'} → <strong>{form.name.trim() || '…'}</strong>
          {form.tinyVersion.trim() && <> (최소: {form.tinyVersion.trim()})</>}
        </p>}

        <fieldset className="habit-field">
          <legend>얼마나 자주?</legend>
          <div className="habit-choice-row">
            {[['weekly', '주 N회'], ['daily', '매일'], ['weekdays', '요일 지정']].map(([type, label]) =>
              <button key={type} type="button" className={`habit-chip ${form.type === type ? 'on' : ''}`}
                aria-pressed={form.type === type} onClick={() => set('type', type)}>{label}</button>)}
          </div>
          {form.type === 'weekly' && <label className="habit-inline">
            일주일에 <input type="number" min={1} max={7} value={form.count} aria-label="주 횟수"
              onChange={e => set('count', e.target.value)} />회 <em>요일은 그때그때 편한 날에</em>
          </label>}
          {form.type === 'weekdays' && <div className="habit-choice-row">
            {WEEK_ORDER.map(day => <button key={day} type="button" className={`habit-chip day ${form.days.includes(day) ? 'on' : ''}`}
              aria-pressed={form.days.includes(day)} onClick={() => toggleDay(day)}>{WEEKDAY_LABELS[day]}</button>)}
          </div>}
        </fieldset>

        <fieldset className="habit-field">
          <legend>언제부터?</legend>
          <div className="habit-choice-row">
            {startSuggestions(today).map(s => <button key={s.id} type="button"
              className={`habit-chip ${form.startDate === s.day ? 'on' : ''}`} aria-pressed={form.startDate === s.day}
              onClick={() => set('startDate', s.day)}>{s.label}</button>)}
            <input type="date" value={form.startDate} aria-label="시작일" onChange={e => set('startDate', e.target.value)} />
          </div>
        </fieldset>

        <div className="habit-form-actions">
          {(form.name.trim() && result.error) && <span className="habit-error">{result.error}</span>}
          {failure && <span className="habit-error" role="alert">{failure}</span>}
          <button type="button" className="btn-signout" onClick={onClose}>취소</button>
          <button type="submit" className="btn btn-login" disabled={Boolean(result.error) || busy}>{habit ? '저장' : '추가'}</button>
        </div>
      </div>
    </form>
  </div>;
}
