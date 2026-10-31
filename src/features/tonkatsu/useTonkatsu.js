import { useEffect, useMemo, useState } from 'react';
import { baseDate, buildViews } from './tonkatsuCore.mjs';
import { subscribeTonkatsu } from './tonkatsuService';

const NAMES = ['members', 'plans', 'checkIns', 'offDays', 'myFines'];
const EMPTY = {};

/** 1분마다 바뀌는 '오늘'(5시 기준). 자정·5시를 넘기면 화면이 알아서 날짜를 바꿈 */
export function useBaseDate() {
  const [today, setToday] = useState(() => baseDate());
  useEffect(() => {
    const timer = setInterval(() => setToday(baseDate()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  return today;
}

/** 돈까스봇의 내 데이터. discordId가 있을 때(연동됨)만 구독 */
export function useTonkatsu(discordId, enabled) {
  const today = useBaseDate();
  const [state, setState] = useState({ key: null, data: {}, error: null });
  const key = discordId && enabled ? discordId : null;

  useEffect(() => {
    if (!key) return undefined;
    let active = true;
    const stop = subscribeTonkatsu(discordId,
      (name, docs) => active && setState((s) => ({ key, data: { ...(s.key === key ? s.data : {}), [name]: docs }, error: s.key === key ? s.error : null })),
      (error) => active && setState((s) => ({ ...s, key, error })));
    return () => { active = false; stop(); };
  }, [key, discordId]);

  const data = state.key === key ? state.data : EMPTY;
  const ready = !!key && NAMES.every((n) => data[n]);
  const views = useMemo(() => (ready ? buildViews(data) : {}), [ready, data]);
  return {
    ready, today, views,
    error: state.key === key ? state.error : null,
    checkIns: data.checkIns || [], offDays: data.offDays || [], myFines: data.myFines || [],
    me: views[discordId] || { completed_goals: [], rest_history: [], exemptions: [], fines: 0, alert_time: 2 },
  };
}
