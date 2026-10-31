import { useEffect, useState } from 'react';
import { createLinkCode, deleteLinkCode } from '../features/discord/discordService';
import { formatLinkCode, remainingSeconds } from '../features/discord/linkCode.mjs';

// 설정 창의 '디스코드 연동' 영역
export default function DiscordLinkSection({ uid, discord, serverInfo }) {
  const [pending, setPending] = useState(null); // { code, createdAt }
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const linked = !!discord.link;

  useEffect(() => {
    if (!pending || linked) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending, linked]);

  // 연동이 끝나면 코드 화면을 닫음 (코드는 봇이 지움)
  useEffect(() => { if (linked) setPending(null); }, [linked]);

  const left = pending ? remainingSeconds(pending.createdAt, now) : 0;
  const expired = pending && left === 0;

  const makeCode = async () => {
    setBusy(true); setFailure('');
    try {
      if (pending) await deleteLinkCode(pending.code).catch(() => {});
      const code = await createLinkCode(uid);
      setPending({ code, createdAt: Date.now() });
      setNow(Date.now());
    } catch {
      setFailure('연동 코드를 만들지 못했습니다. 인터넷 연결과 Firebase 규칙 게시 여부를 확인해 주세요.');
    } finally { setBusy(false); }
  };

  const copyCommand = () => navigator.clipboard?.writeText(`/연동 코드:${pending.code}`).catch(() => {});

  return <section className="schedule-settings-timer discord-link">
    <h3>디스코드 연동</h3>
    {!discord.ready && <p>연동 상태를 확인하는 중…</p>}
    {discord.error && <p role="alert">연동 상태를 불러오지 못했습니다. Firebase 규칙이 게시되었는지 확인해 주세요.</p>}
    {discord.ready && linked && <>
      <p>✅ {serverInfo?.name ? <strong>{serverInfo.name}</strong> : '디스코드 서버'}와 연동되어 있습니다.</p>
      <p className="discord-link-note">해제하려면 디스코드에서 <code>/연동 동작:연동 해제</code>를 입력하세요.</p>
    </>}
    {discord.ready && !linked && <>
      <p className="discord-link-note">돈까스봇과 연동하면 앱에서 계획을 인증하고 멤버들의 진행 상황을 볼 수 있어요. 앱 없이 디스코드만 써도 괜찮아요.</p>
      {pending && !expired && <div className="discord-link-code">
        <code aria-label="연동 코드">{formatLinkCode(pending.code)}</code>
        <p>디스코드에서 <code>/연동 코드:{pending.code}</code> 를 입력하세요. ({Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} 남음)</p>
        <button type="button" className="btn-signout" onClick={copyCommand}>명령어 복사</button>
      </div>}
      {expired && <p role="status">코드가 만료되었습니다. 새 코드를 받아 주세요.</p>}
      <button type="button" className="btn btn-login" onClick={makeCode} disabled={busy}>
        {busy ? '만드는 중…' : pending ? '새 코드 받기' : '연동 코드 받기'}
      </button>
    </>}
    {failure && <p role="alert">{failure}</p>}
  </section>;
}
