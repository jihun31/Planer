import { useSyncExternalStore } from 'react';
import { DEFAULT_BREAK_NUDGE_MINUTES, isBreakNudgeMinutes } from './flowtime.mjs';

const changeEvent = 'planer:timer-preferences';
function subscribe(onChange) {
  window.addEventListener(changeEvent, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener('storage', onChange);
  };
}

// Window behavior belongs to this device and account, rather than calendar history.
export function useTimerPopupPreference(uid) {
  const key = uid ? `planer:timer-popup:${uid}` : null;
  const enabled = useSyncExternalStore(subscribe, () => {
    try { return !key || window.localStorage.getItem(key) !== 'false'; }
    catch { return true; }
  }, () => true);
  const setEnabled = value => {
    if (!key || typeof value !== 'boolean') throw new Error('Invalid timer preference');
    window.localStorage.setItem(key, String(value));
    window.dispatchEvent(new Event(changeEvent));
  };
  return [enabled, setEnabled];
}

export function useStudyGapPreference(uid) {
  const key = uid ? `planer:study-gap-control:${uid}` : null;
  const enabled = useSyncExternalStore(subscribe, () => {
    try { return !!key && window.localStorage.getItem(key) === 'true'; }
    catch { return false; }
  }, () => false);
  const setEnabled = value => {
    if (!key || typeof value !== 'boolean') throw new Error('Invalid timer preference');
    window.localStorage.setItem(key,String(value));
    window.dispatchEvent(new Event(changeEvent));
  };
  return [enabled,setEnabled];
}

export function useTimerPopupPosition(uid) {
  const key = uid ? `planer:timer-popup-position:${uid}` : null;
  const position = useSyncExternalStore(subscribe, () => {
    try {return key && window.localStorage.getItem(key) === 'left' ? 'left' : 'right';}
    catch {return 'right';}
  }, () => 'right');
  const setPosition = value => {
    if (!key || !['left','right'].includes(value)) throw new Error('Invalid timer position');
    window.localStorage.setItem(key,value);
    window.dispatchEvent(new Event(changeEvent));
  };
  return [position,setPosition];
}

// 타이머를 정지하면 다음 활동(기록·통제 배지)을 고르는 창을 띄운다. 기본은 끔.
export function useTimerSwitchPreference(uid) {
  const key = uid ? `planer:timer-switch-prompt:${uid}` : null;
  const enabled = useSyncExternalStore(subscribe, () => {
    try { return !!key && window.localStorage.getItem(key) === 'true'; }
    catch { return false; }
  }, () => false);
  const setEnabled = value => {
    if (!key || typeof value !== 'boolean') throw new Error('Invalid timer preference');
    window.localStorage.setItem(key, String(value));
    window.dispatchEvent(new Event(changeEvent));
  };
  return [enabled, setEnabled];
}

// Flowtime식 집중·휴식 연결. 두 기능 모두 기본으로 켜 두고 설정에서 끌 수 있다.
function useBooleanPreference(key, fallback) {
  const enabled = useSyncExternalStore(subscribe, () => {
    try {
      const value = key ? window.localStorage.getItem(key) : null;
      return value === null ? fallback : value === 'true';
    } catch { return fallback; }
  }, () => fallback);
  const setEnabled = value => {
    if (!key || typeof value !== 'boolean') throw new Error('Invalid timer preference');
    window.localStorage.setItem(key, String(value));
    window.dispatchEvent(new Event(changeEvent));
  };
  return [enabled, setEnabled];
}

// 기록 타이머가 오래 돌면 타이머에 작은 휴식 알림을 띄운다.
export function useBreakNudgePreference(uid) {
  return useBooleanPreference(uid ? `planer:break-nudge:${uid}` : null, true);
}

// 기록 타이머를 정지하면 일한 시간에 맞춘 길이로 휴식 타이머를 바로 시작한다.
export function useFlowRestPreference(uid) {
  return useBooleanPreference(uid ? `planer:flow-rest:${uid}` : null, true);
}

export function useBreakNudgeMinutes(uid) {
  const key = uid ? `planer:break-nudge-minutes:${uid}` : null;
  const minutes = useSyncExternalStore(subscribe, () => {
    try {
      const value = key ? Number(window.localStorage.getItem(key)) : NaN;
      return isBreakNudgeMinutes(value) ? value : DEFAULT_BREAK_NUDGE_MINUTES;
    } catch { return DEFAULT_BREAK_NUDGE_MINUTES; }
  }, () => DEFAULT_BREAK_NUDGE_MINUTES);
  const setMinutes = value => {
    if (!key || !isBreakNudgeMinutes(value)) throw new Error('Invalid timer preference');
    window.localStorage.setItem(key, String(value));
    window.dispatchEvent(new Event(changeEvent));
  };
  return [minutes, setMinutes];
}
