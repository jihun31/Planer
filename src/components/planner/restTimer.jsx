import React from 'react';
import { createPortal } from 'react-dom';
import { controlColor } from '../../features/planner/controlColors.mjs';
import { timerSegments } from '../../features/planner/scheduleTime.mjs';
import '../../styles/rest-timer.css';

function createPlanerRest(React, createPortal) {
  const { useEffect, useRef, useState } = React;
  const optionId = '__planer_builtin_rest__';
  const restName = '휴식';
  const color = '#6366f1';
  const presets = [5, 10, 15, 30];
  const minute = 60_000;
  const keyFor = uid => `planer:rest-plan:v1:${uid}`;
  const isRestName = name => typeof name === 'string' && name.normalize('NFKC').trim() === restName;
  const findRest = activities => activities.find(activity => isRestName(activity.name));
  const isMinutes = value => Number.isInteger(value) && value >= 1 && value <= 1440;
  const isDuration = value => value === null || isMinutes(value);
  const hasEnded = (session, now) => session.endTs !== null && session.endTs <= now;
  const sessionKey = session => `${session.startTs}:${session.endTs}`;

  function read(uid) {
    let data;
    try { data = JSON.parse(localStorage.getItem(keyFor(uid))); } catch { /* Use defaults. */ }
    const activities = Array.isArray(data?.activities)
      ? data.activities.filter(item => typeof item?.id === 'string' && typeof item.name === 'string' && item.name.trim())
      : [];
    const session = data?.session;
    const validSession = session && Number.isFinite(session.startTs)
      && (session.endTs === null || (Number.isFinite(session.endTs) && session.endTs >= session.startTs))
      && typeof session.name === 'string' && typeof session.action === 'string';
    return {
      activities,
      minutes: isDuration(data?.minutes) ? data.minutes : 10,
      session: validSession ? session : null,
    };
  }

  function useReturnTimer(target, activities, start) {
    const applied = useRef(null);
    useEffect(() => {
      if (!target || applied.current === target || !activities.some(item => item.id === target.activityId)) return;
      applied.current = target;
      start(target.activityId);
    }, [target, activities, start]);
  }

  function Shortcut({ onClick }) {
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

  function RestSetup({ store, onSaveActivities, onStart, onCancel, returnActivities }) {
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

  function RestReview({ action, saving, finalizing, onEnd, onReturn, onExtend }) {
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

  function RestDialog({ title, mode, error, onCancel, children }) {
    const dialog = useRef(null);
    useEffect(() => {
      const node = dialog.current;
      node.showModal();
      node.querySelector('[data-rest-focus]')?.focus();
      if (mode === 'review') window.electronAPI?.closeRestPopup?.(true);
      return () => node.close();
    }, [mode]);
    return createPortal(<dialog ref={dialog} className={`study-gap-dialog planer-rest-dialog planer-rest-${mode}`}
      aria-labelledby="planer-rest-title" onCancel={event => { event.preventDefault(); onCancel?.(); }}>
      <h2 id="planer-rest-title">{title}</h2>
      {children}
      {error && <p className="planer-rest-feedback" role="alert">{error}</p>}
    </dialog>, document.body);
  }

  function useTimer({ uid, enabled, popupPosition, lock, unlock, returnActivities = [], onSaveTimer, onReturn }) {
    const [store, setStore] = useState(() => enabled ? read(uid) : null);
    const [editing, setEditing] = useState(false);
    const [observedTime, setObservedTime] = useState(Date.now);
    const [error, setError] = useState('');
    const [popupError, setPopupError] = useState('');
    const [saving, setSaving] = useState(false);
    const current = useRef(store);
    const editingRef = useRef(false);
    const savingRef = useRef(false);
    const ownership = useRef({ lock, unlock });
    ownership.current = { lock, unlock };
    const session = store?.session;
    const reviewing = Boolean(session && hasEnded(session, observedTime));
    const availableActivities = returnActivities.filter(item => !item.archived);
    const reminderKey = session ? sessionKey(session) : null;

    useEffect(() => {
      if (!enabled) return;
      if (current.current.session) ownership.current.lock();
      return () => {
        ownership.current.unlock();
        window.electronAPI?.closeRestPopup?.();
      };
    }, [enabled]);

    useEffect(() => {
      if (!session || session.endTs === null || hasEnded(session, Date.now())) return;
      const api = window.electronAPI;
      api?.scheduleRestReminder?.({ key: reminderKey, endTs: session.endTs });
      return () => api?.clearRestReminder?.(reminderKey);
    }, [reminderKey]);

    useEffect(() => {
      if (!session || session.endTs === null || reviewing) return;
      let timeout;
      function checkDeadline() {
        const now = Date.now();
        clearTimeout(timeout);
        if (hasEnded(session, now)) setObservedTime(now);
        else timeout = setTimeout(checkDeadline, session.endTs - now);
      }
      checkDeadline();
      window.addEventListener('focus', checkDeadline);
      return () => {
        clearTimeout(timeout);
        window.removeEventListener('focus', checkDeadline);
      };
    }, [session, reviewing]);

    useEffect(() => {
      if (session && !reviewing) void showPopup(false);
    }, [session, reviewing, popupPosition]);

    useEffect(() => {
      if (!enabled) return;
      return window.electronAPI?.onRestPopupCommand?.(command => {
        const active = current.current.session;
        if (!active || command?.key !== sessionKey(active)) return;
        if (command.type === 'end') endEarly();
        if (command.type === 'expire') setObservedTime(Date.now());
      });
    });

    async function showPopup(reveal = true) {
      const active = current.current.session;
      if (!active) return;
      const now = Date.now();
      if (hasEnded(active, now)) { setObservedTime(now); return; }
      let result;
      try {
        result = await window.electronAPI?.openRestPopup?.({
          actName: active.name, color, startTs: active.startTs, endTs: active.endTs,
          position: popupPosition, reveal,
        });
      } catch { /* The timer card can reopen the window. */ }
      if (current.current.session === active) setPopupError(result?.ok ? '' : '휴식 타이머를 열지 못했어요. 다시 시도해 주세요.');
    }

    function save(next) {
      try { localStorage.setItem(keyFor(uid), JSON.stringify(next)); }
      catch { setError('휴식 계획을 저장하지 못했어요. 다시 시도해 주세요.'); return false; }
      setError('');
      current.current = next;
      setStore(next);
      return true;
    }

    function open() {
      if (!enabled || editingRef.current) return;
      if (current.current.session) { void showPopup(); return; }
      lock();
      editingRef.current = true;
      setEditing(true);
    }

    function cancel() {
      editingRef.current = false;
      setEditing(false);
      setError('');
      unlock();
    }

    function start({ name, minutes, action, returnActivityId }) {
      if (!editingRef.current || current.current.session) return;
      const startTs = Date.now();
      const endTs = minutes === null ? null : startTs + minutes * minute;
      if (!save({ ...current.current, minutes, session: { startTs, endTs, name, action, returnActivityId } })) return;
      setObservedTime(startTs);
      editingRef.current = false;
      setEditing(false);
      // 공부 타이머를 시작할 때와 같이 메인 창을 내린다(팝업은 session 효과가 연다).
      window.electronAPI?.minimizeMain?.();
    }

    function extend(minutes) {
      const active = current.current.session;
      const timestamp = Date.now();
      if (!active || active.finalizing || !hasEnded(active, timestamp) || !isDuration(minutes)) return;
      const endTs = minutes === null ? null : timestamp + minutes * minute;
      if (save({ ...current.current, session: { ...active, endTs } })) setObservedTime(timestamp);
    }

    function endEarly() {
      const active = current.current.session;
      if (!active) return;
      const timestamp = Math.max(active.startTs, Date.now());
      if (hasEnded(active, timestamp) || save({ ...current.current, session: { ...active, endTs: timestamp } })) {
        setObservedTime(timestamp);
      }
    }

    async function finish(returnToWork) {
      const active = current.current.session;
      if (!active || savingRef.current || !hasEnded(active, Date.now())) return;
      // Keep the interval fixed across retries, including after an app restart.
      if (!active.finalizing && !save({ ...current.current, session: { ...active, finalizing: true } })) return;

      savingRef.current = true;
      setSaving(true);
      setError('');
      try {
        const { startTs, endTs, name } = active;
        let segments = timerSegments(startTs, endTs);
        if (!segments.length && endTs > startTs) {
          const firstMinute = Math.floor(startTs / minute) * minute;
          segments = timerSegments(firstMinute, firstMinute + minute);
        }
        if (segments.length) {
          await onSaveTimer({
            startTs, segments,
            metadata: { activityId: null, customName: name, customColor: controlColor('controlled'), group: 'controlled' },
          });
        }
      } catch {
        setError('휴식 기록을 저장하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
        return;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }

      if (!save({ ...current.current, session: null })) return;
      unlock();
      if (returnToWork) onReturn?.(active.returnActivityId);
    }

    const panel = editing ? <RestDialog key="setup" mode="setup" title="휴식 계획" error={error} onCancel={cancel}>
      <RestSetup store={store} returnActivities={availableActivities} onStart={start} onCancel={cancel}
        onSaveActivities={activities => save({ ...current.current, activities })} />
    </RestDialog> : reviewing ? <RestDialog key="review" mode="review" title={session.action ? '복귀 후 첫 행동' : '휴식 종료'} error={error}>
      <RestReview action={session.action} saving={saving} finalizing={session.finalizing}
        onEnd={() => finish(false)} onReturn={() => finish(true)} onExtend={extend} />
    </RestDialog> : session && (popupError || error) ? <p role="alert">{popupError || error}</p> : null;

    return { open, busy: Boolean(editing || session), active: Boolean(session), panel };
  }

  return { optionId, restName, findRest, isRestName, read, useReturnTimer, Shortcut, useTimer };
}

export const restTimer = createPlanerRest(React, createPortal);
