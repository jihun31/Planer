import { useEffect, useState } from 'react';
import { createLinkCode, deleteLinkCode } from '../features/discord/discordService';
import { formatLinkCode, remainingSeconds } from '../features/discord/linkCode.mjs';
import { useSettingHelp } from './SettingHelp';
import { useCheckInAlertTime } from '../features/tonkatsu/useCheckInAlert';
import { DEFAULT_ALERT_TIME } from '../features/tonkatsu/checkInAlert.mjs';

// 오늘 할 인증이 남았을 때 띄우는 PC 알림의 시각. 이 기기에만 저장하고, 디스코드 알림 시간과는 따로 동작한다.
function CheckInAlertSetting({ uid }) {
  const [time, setTime] = useCheckInAlertTime(uid);
  const [lastTime, setLastTime] = useState(time || DEFAULT_ALERT_TIME);
  const [failure, setFailure] = useState('');
  const save = value => {
    try { setTime(value); if (value) setLastTime(value); setFailure(''); }
    catch { setFailure('알림 설정을 저장하지 못했습니다. 이 기기의 저장 공간 접근을 확인해 주세요.'); }
  };
  return <div className="checkin-alert-setting">
    <label>인증 안 했을 때 PC 알림
      <input type="checkbox" checked={!!time} onChange={e => save(e.target.checked ? lastTime : null)} /></label>
    {time && <AlertTimeFields time={time} onSave={save} />}
    {failure && <p role="alert">{failure}</p>}
  </div>;
}

// 시(00~23)·분(00~59)을 24시간제로 직접 입력한다. 둘 다 맞으면 바로 저장하고, 칸을 벗어날 때 두 자리로 맞춘다.
function AlertTimeFields({ time, onSave }) {
  const [draft, setDraft] = useState(() => { const [hour, minute] = time.split(':'); return { hour, minute }; });
  const valid = ({ hour, minute }) => /^\d{1,2}$/.test(hour) && /^\d{1,2}$/.test(minute) && Number(hour) <= 23 && Number(minute) <= 59;
  const format = ({ hour, minute }) => `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  const change = (field, value) => {
    const next = { ...draft, [field]: value.replace(/\D/g, '').slice(0, 2) };
    setDraft(next);
    if (valid(next) && format(next) !== time) onSave(format(next));
  };
  const blur = () => {
    if (valid(draft)) { const [hour, minute] = format(draft).split(':'); setDraft({ hour, minute }); }
    else { const [hour, minute] = time.split(':'); setDraft({ hour, minute }); }
  };
  const field = (name, label) => <input type="text" inputMode="numeric" maxLength={2} className="checkin-alert-time" aria-label={label}
    value={draft[name]} onChange={e => change(name, e.target.value)} onBlur={blur} onFocus={e => e.target.select()} />;
  return <div className="checkin-alert-time-row">
    <span>알림 시각 <small>(24시간제, 밤 12시 30분은 00:30)</small></span>
    <span>{field('hour', '인증 알림 시')}:{field('minute', '인증 알림 분')}</span>
  </div>;
}

// 설정 창의 '디스코드 연동' 영역
export default function DiscordLinkSection({ uid, discord, serverInfo }) {
  const help = useSettingHelp();
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
    <h3 className="setting-help-label">디스코드 연동{help.button('discord', '디스코드 연동')}</h3>
    {!discord.ready && <p>연동 상태를 확인하는 중…</p>}
    {discord.error && <p role="alert">연동 상태를 불러오지 못했습니다. Firebase 규칙이 게시되었는지 확인해 주세요.</p>}
    {discord.ready && linked && <>
      <p>✅ {serverInfo?.name ? <strong>{serverInfo.name}</strong> : '디스코드 서버'}와 연동되어 있습니다.</p>
      <CheckInAlertSetting uid={uid} />
      {help.shown('discord') && <p className="discord-link-note">Planner가 켜져 있을 때, 정한 시각까지 오늘 인증할 계획이 남아 있으면 Windows 알림을 한 번 보냅니다. 새벽 5시 전 시각은 그날 밤으로 칩니다.</p>}
      {help.shown('discord') && <p className="discord-link-note">해제하려면 디스코드에서 <code>/연동 동작:연동 해제</code>를 입력하세요.</p>}
    </>}
    {discord.ready && !linked && <>
      {help.shown('discord') && <p className="discord-link-note">돈까스봇과 연동하면 앱에서 계획을 인증하고 멤버들의 진행 상황을 볼 수 있어요. 앱 없이 디스코드만 써도 괜찮아요.</p>}
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
