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

function useBooleanPreference(key, fallback) {
  const enabled = useSyncExternalStore(subscribe, () => {
    try {
      const value = key ? window.localStorage.getItem(key) : null;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return fallback;
    } catch { return fallback; }
  }, () => fallback);
  const setEnabled = value => {
    if (!key || typeof value !== 'boolean') throw new Error('Invalid timer preference');
    window.localStorage.setItem(key, String(value));
    window.dispatchEvent(new Event(changeEvent));
  };
  return [enabled, setEnabled];
}

// Window behavior belongs to this device and account, rather than calendar history.
export function useTimerPopupPreference(uid) {
  return useBooleanPreference(uid ? `planer:timer-popup:${uid}` : null, true);
}

export function useStudyGapPreference(uid) {
  return useBooleanPreference(uid ? `planer:study-gap-control:${uid}` : null, false);
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
  return useBooleanPreference(uid ? `planer:timer-switch-prompt:${uid}` : null, false);
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
