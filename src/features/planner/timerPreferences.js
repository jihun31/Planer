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
