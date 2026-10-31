import { useEffect, useState } from 'react';

// 새 버전을 다 받았을 때 화면 위에 띄우는 안내. 데스크톱 앱(설치본)에서만 동작
export default function UpdateBanner() {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  const [state, setState] = useState(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!api?.onUpdateStatus) return undefined;
    let active = true;
    api.getUpdateState?.().then((s) => active && s && setState(s)).catch(() => {});
    const stop = api.onUpdateStatus((s) => active && setState(s));
    return () => { active = false; stop?.(); };
  }, [api]);

  if (hidden || state?.status !== 'ready') return null;
  return <div className="update-banner" role="status">
    <span>🎉 새 버전{state.version ? ` ${state.version}` : ''}이 준비됐어요.</span>
    <button type="button" className="btn btn-login" onClick={() => api.installUpdate()}>지금 다시 시작</button>
    <button type="button" className="btn-signout" onClick={() => setHidden(true)}>나중에 (앱을 끌 때 설치)</button>
  </div>;
}
