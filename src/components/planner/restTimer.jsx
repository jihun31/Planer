import { useCallback, useEffect, useRef, useState } from 'react';
import { controlColor } from '../../features/planner/controlColors.mjs';
import { timerSegments } from '../../features/planner/scheduleTime.mjs';
import {
  color, findRest, hasEnded, isDuration, isMinutes, isRestName,
  keyFor, minute, optionId, read, restName, sessionKey,
} from './restTimerCore.mjs';
import { RestDialog, RestReview, RestSetup, Shortcut } from './RestTimerViews';
import '../../styles/rest-timer.css';

function useReturnTimer(target, activities, start) {
  const applied = useRef(null);
  useEffect(() => {
    if (!target || applied.current === target || !activities.some(item => item.id === target.activityId)) return;
    applied.current = target;
    start(target.activityId);
  }, [target, activities, start]);
}

function useTimer({ uid, enabled, popupPosition, popupCompact = true, lock, unlock, returnActivities = [], onSaveTimer, onReturn }) {
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
  const reminderEndTs = session?.endTs ?? null;

  const showPopup = useCallback(async (reveal = true) => {
    const active = current.current.session;
    if (!active) return;
    const now = Date.now();
    if (hasEnded(active, now)) { setObservedTime(now); return; }
    let result;
    try {
      result = await window.electronAPI?.openRestPopup?.({
        actName: active.name, color, startTs: active.startTs, endTs: active.endTs,
        position: popupPosition, compact: popupCompact, reveal,
      });
    } catch { /* The timer card can reopen the window. */ }
    if (current.current.session === active) setPopupError(result?.ok ? '' : '휴식 타이머를 열지 못했어요. 다시 시도해 주세요.');
  }, [popupPosition, popupCompact]);

  function save(next) {
    try { localStorage.setItem(keyFor(uid), JSON.stringify(next)); }
    catch { setError('휴식 계획을 저장하지 못했어요. 다시 시도해 주세요.'); return false; }
    setError('');
    current.current = next;
    setStore(next);
    return true;
  }

  function endEarly() {
    const active = current.current.session;
    if (!active) return;
    const timestamp = Math.max(active.startTs, Date.now());
    if (hasEnded(active, timestamp) || save({ ...current.current, session: { ...active, endTs: timestamp } })) {
      setObservedTime(timestamp);
    }
  }

  const endEarlyRef = useRef(endEarly);
  endEarlyRef.current = endEarly;

  useEffect(() => {
    if (!enabled) return;
    if (current.current.session) ownership.current.lock();
    return () => {
      ownership.current.unlock();
      window.electronAPI?.closeRestPopup?.();
    };
  }, [enabled]);

  useEffect(() => {
    if (!reminderKey || reminderEndTs === null || reminderEndTs <= Date.now()) return;
    const api = window.electronAPI;
    api?.scheduleRestReminder?.({ key: reminderKey, endTs: reminderEndTs });
    return () => api?.clearRestReminder?.(reminderKey);
  }, [reminderKey, reminderEndTs]);

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
  }, [session, reviewing, showPopup]);

  const hasSession = Boolean(session);
  useEffect(() => {
    if (!enabled || !hasSession) return;
    return window.electronAPI?.onRestPopupCommand?.(command => {
      const active = current.current.session;
      if (!active || command?.key !== sessionKey(active)) return;
      if (command.type === 'end') endEarlyRef.current();
      if (command.type === 'expire') setObservedTime(Date.now());
    });
  }, [enabled, hasSession]);

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

  // 기록 타이머를 정지한 순간 설정 창 없이 바로 휴식을 시작한다(Flowtime 연결).
  // 기본 휴식 시간(store.minutes)은 직접 고른 값으로 남겨 둔다.
  function startNow({ minutes, returnActivityId }) {
    if (!enabled || editingRef.current || current.current.session || !isMinutes(minutes)) return false;
    const startTs = Date.now();
    const returnId = availableActivities.some(item => item.id === returnActivityId) ? returnActivityId : undefined;
    if (!save({ ...current.current, session: { startTs, endTs: startTs + minutes * minute, name: restName, action: '', returnActivityId: returnId } })) return false;
    lock();
    setObservedTime(startTs);
    window.electronAPI?.minimizeMain?.();
    return true;
  }

  function extend(minutes) {
    const active = current.current.session;
    const timestamp = Date.now();
    if (!active || active.finalizing || !hasEnded(active, timestamp) || !isDuration(minutes)) return;
    const endTs = minutes === null ? null : timestamp + minutes * minute;
    if (save({ ...current.current, session: { ...active, endTs } })) setObservedTime(timestamp);
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

  return { open, startNow, busy: Boolean(editing || session), active: Boolean(session), panel };
}

export const restTimer = { optionId, restName, findRest, isRestName, read, useReturnTimer, Shortcut, useTimer };
