import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { color, isDuration, isMinutes, presets, restName } from './restTimerCore.mjs';

export function Shortcut({ onClick }) {
  return <span className="act-chip planer-rest-shortcut">
    <span className="act-chip-dot" />
    <button type="button" className="act-chip-start" title="휴식 타이머 시작" onClick={onClick}>{restName}</button>
  </span>;
}

function ActivityBadges({ activities, selected, onSelect, label, rest = false }) {
  return <div className="act-chips" role="group" aria-label={label}>
    {activities.map(activity => (
      <button type="button" key={activity.id} className={`act-chip planer-rest-badge${rest ? ' planer-rest-activity-badge' : ''}`}
        aria-pressed={selected === activity.id} onClick={() => onSelect(activity)}
        style={{ '--rest-badge-color': /^#[0-9a-f]{6}$/i.test(activity.color) ? activity.color : color }}>
        <span className="act-chip-dot" aria-hidden="true" />
        <span>{activity.name}</span>
      </button>
    ))}
  </div>;
}

function DurationPicker({ value, onChange }) {
  const [custom, setCustom] = useState(isMinutes(value) && !presets.includes(value));
  return <div className="study-gap-actions study-gap-ranges planer-rest-times" role="group" aria-label="시간 선택">
    {presets.map(minutes => <button type="button" key={minutes} aria-pressed={!custom && value === minutes}
      onClick={() => { setCustom(false); onChange(minutes); }}>{minutes}분</button>)}
    <button type="button" aria-pressed={custom} onClick={() => { setCustom(true); onChange(''); }}>직접 입력</button>
    <button type="button" aria-pressed={value === null}
      onClick={() => { setCustom(false); onChange(null); }}>제한 없음</button>
    {custom && <input autoFocus type="number" min="1" max="1440"
      aria-label="분 직접 입력" placeholder="분" value={value}
      onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))} />}
  </div>;
}

function ActivityPicker({ activities, selected, onSelect, onSave }) {
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const field = useRef(null);
  const current = activities.find(item => item.id === selected);
  const cleanName = name.trim().normalize('NFC');
  const duplicate = activities.some(item => item.id !== editing && item.name === cleanName);

  function submit() {
    if (!managing || !cleanName || duplicate) return;
    const id = editing ?? crypto.randomUUID();
    const next = editing
      ? activities.map(item => item.id === editing ? { id, name: cleanName } : item)
      : [...activities, { id, name: cleanName }];
    if (!onSave(next)) return;
    setEditing(null);
    setName('');
  }

  function cancelRename() {
    if (!editing) return;
    setEditing(null);
    setName('');
  }

  return <div className="planer-rest-field">
    <div className="study-gap-actions planer-rest-row planer-rest-field-heading">
      <span>휴식 활동</span>
      <button type="button" className="planer-rest-text-button" aria-expanded={managing} onClick={() => {
        setManaging(!managing);
        setEditing(null);
        setName('');
      }}>{managing ? '관리 완료' : '활동 관리'}</button>
    </div>
    {!!activities.length && <ActivityBadges rest activities={activities} selected={selected} label="휴식 활동 선택"
      onSelect={item => {
        cancelRename();
        onSelect(item.id === selected ? '' : item.id);
      }} />}
    {managing && <div className="study-gap-actions planer-rest-row">
      <input id="planer-rest-activity" ref={field}
        autoFocus aria-label={editing ? '휴식 활동 이름 수정' : '새 휴식 활동 이름'}
        placeholder="활동 이름" value={name} maxLength={80} onChange={event => setName(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
        }} />
      <button type="button" disabled={!cleanName || duplicate} onClick={submit}>
        {editing ? '저장' : '+ 활동 추가'}
      </button>
    </div>}
    {duplicate && <span className="planer-rest-feedback" role="status">이미 등록된 활동이에요.</span>}
    {managing && current && <div className="study-gap-actions planer-rest-row">
        <button type="button" aria-label={`${current.name} 수정`} onClick={() => {
          setEditing(current.id);
          setName(current.name);
          field.current?.focus();
        }}>수정</button>
        <button type="button" aria-label={`${current.name} 삭제`} onClick={() => {
          const next = activities.filter(activity => activity.id !== current.id);
          if (!onSave(next)) return;
          onSelect('');
          cancelRename();
        }}>삭제</button>
    </div>}
  </div>;
}

export function RestSetup({ store, onSaveActivities, onStart, onCancel, returnActivities }) {
  const [activityId, setActivityId] = useState('');
  const [minutes, setMinutes] = useState(store.minutes);
  const [action, setAction] = useState('');
  const [returnActivityId, setReturnActivityId] = useState('');
  const activity = store.activities.find(item => item.id === activityId);
  const returnActivity = returnActivities.find(item => item.id === returnActivityId);
  const ready = isDuration(minutes);
  return <form onSubmit={event => {
    event.preventDefault();
    if (ready) onStart({ name: activity?.name ?? restName, minutes, action: action.trim(), returnActivityId: returnActivity?.id });
  }}>
    <ActivityPicker activities={store.activities} selected={activityId} onSelect={setActivityId} onSave={onSaveActivities} />
    <div className="planer-rest-field">
      <span>휴식 시간</span>
      <DurationPicker value={minutes} onChange={setMinutes} />
    </div>
    <div className="planer-rest-field">
      <label htmlFor="planer-rest-action">복귀 후 첫 행동</label>
      <input id="planer-rest-action" data-rest-focus={store.activities.length ? '' : undefined}
        value={action} maxLength={150} placeholder="예: 보고서 파일 열기" onChange={event => setAction(event.target.value)} />
      {!!returnActivities.length && <>
        <span className="planer-rest-badge-label">시간 관리 활동</span>
        <ActivityBadges activities={returnActivities} selected={returnActivityId} label="시간 관리 활동 선택"
          onSelect={item => setReturnActivityId(returnActivityId === item.id ? '' : item.id)} />
      </>}
    </div>
    <div className="study-gap-actions">
      <button type="button" className="study-gap-cancel" onClick={onCancel}>취소</button>
      <button type="submit" className="study-gap-primary"
        disabled={!ready}>휴식 시작</button>
    </div>
  </form>;
}

export function RestReview({ action, saving, finalizing, onEnd, onReturn, onExtend }) {
  const [extending, setExtending] = useState(false);
  const [minutes, setMinutes] = useState('');
  return <>
    {action && <div className="study-gap-ranges planer-rest-action">{action}</div>}
    <div className="study-gap-actions">
      <button type="button" className="study-gap-cancel" onClick={onEnd} disabled={saving}>종료</button>
      <button type="button" aria-expanded={extending && !finalizing} disabled={finalizing}
        onClick={() => setExtending(!extending)}>휴식 연장</button>
      <button type="button" className="study-gap-primary" data-rest-focus onClick={onReturn} disabled={saving}>업무 복귀</button>
    </div>
    {saving && <p role="status">휴식 기록 저장 중…</p>}
    {extending && !finalizing && <form className="planer-rest-field planer-rest-extend" onSubmit={event => {
      event.preventDefault();
      if (isDuration(minutes)) onExtend(minutes);
    }}>
      <span>추가로 쉴 시간</span>
      <DurationPicker value={minutes} onChange={setMinutes} />
      <div className="study-gap-actions">
        <button type="submit" className="study-gap-primary" disabled={!isDuration(minutes)}>연장 시작</button>
      </div>
    </form>}
  </>;
}

export function RestDialog({ title, mode, error, onCancel, children }) {
  const dialog = useRef(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (!node.open) node.showModal();
    node.querySelector('[data-rest-focus]')?.focus();
    if (mode === 'review') window.electronAPI?.closeRestPopup?.(true);
    return () => { if (node.open) node.close(); };
  }, [mode]);
  return createPortal(<dialog ref={dialog} className={`study-gap-dialog planer-rest-dialog planer-rest-${mode}`}
    aria-labelledby="planer-rest-title" onCancel={event => { event.preventDefault(); onCancel?.(); }}>
    <h2 id="planer-rest-title">{title}</h2>
    {children}
    {error && <p className="planer-rest-feedback" role="alert">{error}</p>}
  </dialog>, document.body);
}
