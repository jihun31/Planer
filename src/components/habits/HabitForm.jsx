import { useState } from 'react';
import EmojiPicker from './EmojiPicker';
import { COUNT_MAX, MONTH_DAY_MAX, NAME_MAX, TEXT_MAX, UNIT_MAX, WEEKDAY_LABELS, WEEK_ORDER, normalizeHabit, startSuggestions }
  from '../../features/habits/habitCore.mjs';

// 주기 버튼 순서: 고정 일정(매일·요일·날짜) → 유연한 일정(주·월 N회)
const SCHEDULE_CHOICES = [['daily', '매일'], ['weekdays', '요일 지정'], ['monthdays', '날짜 지정'], ['weekly', '주 N회'], ['monthly', '월 N회']];
const MONTH_DAYS = Array.from({ length: MONTH_DAY_MAX }, (_, i) => i + 1);

// 습관 추가·수정 창. "[이미 하는 일] 하고 나서 → [작은 행동]" 형태로 받는다(Fogg의 앵커, Gollwitzer의 if-then 계획).
export default function HabitForm({ habit, today, onSave, onArchive, onClose }) {
  const [form, setForm] = useState(() => ({
    name: habit?.name ?? '',
    emoji: habit?.emoji ?? '',
    anchor: habit?.anchor ?? '',
    tinyVersion: habit?.tinyVersion ?? '',
    type: habit?.schedule?.type ?? 'weekly',
    count: habit?.schedule?.type === 'weekly' ? habit.schedule.count : 3,
    monthCount: habit?.schedule?.type === 'monthly' ? habit.schedule.count : 10,
    days: habit?.schedule?.type === 'weekdays' ? habit.schedule.days : [],
    monthDays: habit?.schedule?.type === 'monthdays' ? habit.schedule.days : [],
    targetType: habit?.target?.type ?? 'check',
    targetValue: habit?.target?.value ?? 8,
    unit: habit?.target?.unit ?? '',
    startDate: habit?.startDate ?? today,
  }));
  const counting = form.targetType === 'count';
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const monthly = form.type === 'monthly' || form.type === 'monthdays';
  const result = normalizeHabit({ ...form, schedule: { type: form.type,
    count: Number(form.type === 'monthly' ? form.monthCount : form.count), days: monthly ? form.monthDays : form.days },
    target: { type: form.targetType, value: Number(form.targetValue), unit: form.unit } });
  const toggle = (key, day) => setForm(f => ({ ...f, [key]: f[key].includes(day) ? f[key].filter(d => d !== day) : [...f[key], day] }));

  const submit = async event => {
    event.preventDefault();
    if (result.error || busy) return;
    setBusy(true);
    setFailure('');
    try { await onSave(result.value); onClose(); }
    catch { setFailure('습관을 저장하지 못했어요. 연결 상태를 확인해 주세요.'); setBusy(false); }
  };
  const archive = async () => {
    if (busy) return;
    setBusy(true);
    setFailure('');
    try { await onArchive(); onClose(); }
    catch { setFailure('습관을 보관하지 못했어요. 연결 상태를 확인해 주세요.'); setBusy(false); }
  };

  return <div className="modal-overlay" onClick={onClose}>
    <form className="modal-box habit-form" onClick={e => e.stopPropagation()} onSubmit={submit}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal-hdr">
        <span className="modal-ttl">{habit ? '습관 수정' : '🔁 새 습관'}</span>
        <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="modal-bdy">
        {/* label로 감싸면 제목을 눌러도 이모지 창이 열려서 div로 둔다 */}
        <div className="habit-field">
          <span>무엇을 할까요? <em>왼쪽에서 이모지를 고를 수 있어요(선택)</em></span>
          <div className="habit-name-row">
            <EmojiPicker value={form.emoji} onChange={emoji => set('emoji', emoji)} />
            <input className="today-add-input" value={form.name} maxLength={NAME_MAX} placeholder="예: 운동 30분" autoFocus
              aria-label="습관 이름" onChange={e => set('name', e.target.value)} />
          </div>
        </div>

        <label className="habit-field">
          <span>언제 할까요? <em>이미 매일 하는 일 뒤에 붙이면 잊지 않아요</em></span>
          <input className="today-add-input" value={form.anchor} maxLength={TEXT_MAX} placeholder="예: 아침에 커피를 마신 뒤"
            aria-label="언제 할지" onChange={e => set('anchor', e.target.value)} />
        </label>

        <fieldset className="habit-field">
          <legend>목표</legend>
          <div className="habit-choice-row">
            {[['check', '한 번 하기'], ['count', '하루 횟수 채우기']].map(([type, label]) =>
              <button key={type} type="button" className={`habit-chip ${form.targetType === type ? 'on' : ''}`}
                aria-pressed={form.targetType === type} onClick={() => set('targetType', type)}>{label}</button>)}
          </div>
          {counting && <label className="habit-inline">
            하루 <input type="number" min={2} max={COUNT_MAX} value={form.targetValue} aria-label="하루 횟수"
              onChange={e => set('targetValue', e.target.value)} />
            <input className="habit-unit-input" value={form.unit} maxLength={UNIT_MAX} placeholder="회" aria-label="단위"
              onChange={e => set('unit', e.target.value)} />
            <em>한 번이라도 하면 최소로 쳐요</em>
          </label>}
        </fieldset>

        {!counting && <label className="habit-field">
          <span>최소 버전 <em>바쁜 날엔 이것만 해도 한 것으로 쳐요</em></span>
          <input className="today-add-input" value={form.tinyVersion} maxLength={TEXT_MAX} placeholder="예: 운동복 갈아입기"
            aria-label="최소 버전" onChange={e => set('tinyVersion', e.target.value)} />
        </label>}

        {(form.anchor.trim() || form.name.trim()) && <p className="habit-preview">
          {form.anchor.trim() || '…'} → <strong>{form.name.trim() || '…'}</strong>
          {counting ? <> (하루 {form.targetValue}{form.unit.trim() || '회'})</>
            : form.tinyVersion.trim() && <> (최소: {form.tinyVersion.trim()})</>}
        </p>}

        <fieldset className="habit-field">
          <legend>얼마나 자주?</legend>
          <div className="habit-choice-row">
            {SCHEDULE_CHOICES.map(([type, label]) =>
              <button key={type} type="button" className={`habit-chip ${form.type === type ? 'on' : ''}`}
                aria-pressed={form.type === type} onClick={() => set('type', type)}>{label}</button>)}
          </div>
          {form.type === 'weekdays' && <div className="habit-choice-row">
            {WEEK_ORDER.map(day => <button key={day} type="button" className={`habit-chip day ${form.days.includes(day) ? 'on' : ''}`}
              aria-pressed={form.days.includes(day)} onClick={() => toggle('days', day)}>{WEEKDAY_LABELS[day]}</button>)}
          </div>}
          {form.type === 'monthdays' && <>
            <div className="habit-month-days" role="group" aria-label="매월 할 날짜">
              {MONTH_DAYS.map(day => <button key={day} type="button" className={`habit-chip day ${form.monthDays.includes(day) ? 'on' : ''}`}
                aria-pressed={form.monthDays.includes(day)} aria-label={`${day}일`} onClick={() => toggle('monthDays', day)}>{day}</button>)}
            </div>
            <em className="habit-note">매달 고른 날짜에 해요. 그달에 없는 날짜(예: 31일)는 말일에 해요</em>
          </>}
          {form.type === 'weekly' && <label className="habit-inline">
            일주일에 <input type="number" min={1} max={7} value={form.count} aria-label="주 횟수"
              onChange={e => set('count', e.target.value)} />회 <em>요일은 그때그때 편한 날에</em>
          </label>}
          {form.type === 'monthly' && <label className="habit-inline">
            한 달에 <input type="number" min={1} max={MONTH_DAY_MAX} value={form.monthCount} aria-label="월 횟수"
              onChange={e => set('monthCount', e.target.value)} />회 <em>날짜는 그때그때 편한 날에</em>
          </label>}
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
          {habit && onArchive && <button type="button" className="block-manage-btn habit-archive-btn" disabled={busy}
            title="기록은 남기고 목록에서 뺍니다" onClick={archive}>보관</button>}
          {(form.name.trim() && result.error) && <span className="habit-error">{result.error}</span>}
          {failure && <span className="habit-error" role="alert">{failure}</span>}
          <button type="button" className="btn-signout" onClick={onClose}>취소</button>
          <button type="submit" className="btn btn-login" disabled={Boolean(result.error) || busy}>{habit ? '저장' : '추가'}</button>
        </div>
      </div>
    </form>
  </div>;
}
