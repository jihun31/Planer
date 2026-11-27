import { useEffect, useSyncExternalStore } from 'react';
import { DEFAULT_ALERT_TIME, alertDateDue, alertMessage, dueTodayPlans, parseAlertTime } from './checkInAlert.mjs';

const changeEvent = 'planer:checkin-alert';
function subscribe(onChange) {
  window.addEventListener(changeEvent, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener('storage', onChange);
  };
}
const read = key => { try { return key ? window.localStorage.getItem(key) : null; } catch { return null; } };

/** 인증 PC 알림 시각 ('HH:MM', 끄면 null). 이 기기·계정에만 저장하고 기본은 00:30 */
export function useCheckInAlertTime(uid) {
  const key = uid ? `planer:checkin-alert:${uid}` : null;
  const time = useSyncExternalStore(subscribe, () => {
    const value = read(key);
    if (value === 'off') return null;
    return parseAlertTime(value) ? value : DEFAULT_ALERT_TIME;
  }, () => DEFAULT_ALERT_TIME);
  const setTime = value => {
    if (!key || (value !== null && !parseAlertTime(value))) throw new Error('Invalid alert time');
    window.localStorage.setItem(key, value ?? 'off');
    window.dispatchEvent(new Event(changeEvent));
  };
  return [time, setTime];
}

/** 알림 시각이 지났는데 오늘 할 인증이 남았으면 Windows 알림을 한 번 띄운다 (앱이 켜져 있을 때만) */
export function useCheckInAlert(uid, discordId, tonkatsu, time) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  const { ready, me } = tonkatsu;
  useEffect(() => {
    if (!uid || !discordId || !time || !ready || !api?.showCheckInAlert) return undefined;
    const sentKey = `planer:checkin-alert-sent:${uid}`;
    const check = () => {
      const date = alertDateDue(time, read(sentKey));
      if (!date) return;
      try { window.localStorage.setItem(sentKey, date); } catch { return; } // 기록을 못 남기면 반복될 수 있어 보내지 않음
      const due = dueTodayPlans(me, date);
      if (due.length) api.showCheckInAlert(alertMessage(due));
    };
    check();
    const timer = setInterval(check, 20 * 1000);
    return () => clearInterval(timer);
  }, [uid, discordId, time, ready, me, api]);
}
