import { useEffect, useState } from 'react';
import { subscribeLink, subscribeServerInfo } from './discordService';

// 내 디스코드 연동 상태: { ready, link: {discordId, ...} | null, error }
export function useDiscordLink(uid) {
  const [state, setState] = useState({ uid: null, link: null, error: null });
  useEffect(() => {
    if (!uid) return undefined;
    let active = true;
    const stop = subscribeLink(uid,
      (link) => active && setState({ uid, link, error: null }),
      (error) => active && setState({ uid, link: null, error }));
    return () => { active = false; stop(); };
  }, [uid]);
  const ready = !!uid && state.uid === uid;
  return { ready, link: ready ? state.link : null, error: ready ? state.error : null };
}

// 연동된 경우에만 디스코드 서버 정보를 구독
export function useServerInfo(linked) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (!linked) return undefined;
    let active = true;
    const stop = subscribeServerInfo((value) => active && setInfo(value), () => active && setInfo(null));
    return () => { active = false; stop(); };
  }, [linked]);
  return linked ? info : null;
}
