import { useSyncExternalStore } from 'react';
import { readTabVisibility } from './tabVisibility.mjs';

const changeEvent = 'planer:tab-visibility';
function subscribe(onChange) {
  window.addEventListener(changeEvent,onChange);
  window.addEventListener('storage',onChange);
  return () => {window.removeEventListener(changeEvent,onChange);window.removeEventListener('storage',onChange);};
}

export function useTabVisibility(uid) {
  const key = uid ? `planer:tab-visibility:${uid}` : null;
  const read = () => {try {return key ? window.localStorage.getItem(key) : null;} catch {return null;}};
  const value = useSyncExternalStore(subscribe,read,() => null);
  const setVisible = (tab,visible) => {
    if (!key || !['control','calendar','notes'].includes(tab) || typeof visible !== 'boolean') throw new Error('Invalid tab preference');
    window.localStorage.setItem(key,JSON.stringify({...readTabVisibility(read()),[tab]:visible}));
    window.dispatchEvent(new Event(changeEvent));
  };
  return [readTabVisibility(value),setVisible];
}
