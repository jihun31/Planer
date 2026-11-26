import { useSyncExternalStore } from 'react';

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

// Flowtime식 집중·휴식 연결. fallback은 저장한 값이 없을 때의 기본값이다.
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

// 타이머 팝업을 콤팩트한 크기로 표시한다. 기본은 켬.
export function useTimerCompactPreference(uid) {
  return useBooleanPreference(uid ? `planer:timer-compact:${uid}` : null, true);
}

// 기록 타이머를 정지하면 다음 활동 창에 일한 시간에 맞춘 "휴식 시작 (N분)" 버튼을 둔다.
// 기본은 끔: 이 설정을 직접 켠(값이 'true'로 저장된) 사용자만 켜진다.
export function useFlowRestPreference(uid) {
  return useBooleanPreference(uid ? `planer:flow-rest:${uid}` : null, false);
}
