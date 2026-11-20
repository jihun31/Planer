import { useMemo, useSyncExternalStore } from 'react';
import { readTabOrder } from './tabVisibility.mjs';

// 계정별 탭 순서. 이 기기에만 저장한다(탭 숨김 설정과 같은 방식).
const changeEvent = 'planer:tab-order';
function subscribe(onChange) {
  window.addEventListener(changeEvent,onChange);
  window.addEventListener('storage',onChange);
  return () => {window.removeEventListener(changeEvent,onChange);window.removeEventListener('storage',onChange);};
}

export function useTabOrder(uid) {
  const key = uid ? `planer:tab-order:${uid}` : null;
  const read = () => {try {return key ? window.localStorage.getItem(key) : null;} catch {return null;}};
  const value = useSyncExternalStore(subscribe,read,() => null);
  // order가 null이면 기본 순서로 되돌린다.
  const setOrder = order => {
    if (!key || (order !== null && !Array.isArray(order))) throw new Error('Invalid tab order');
    if (order === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key,JSON.stringify(readTabOrder(JSON.stringify(order))));
    window.dispatchEvent(new Event(changeEvent));
  };
  return [useMemo(() => readTabOrder(value),[value]),setOrder];
}
