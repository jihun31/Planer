import { useState } from 'react';
import { CATEGORY_KR, iterPlans, memberSummary, progressLine } from '../../features/tonkatsu/tonkatsuCore.mjs';
import '../../styles/tonkatsu.css';

const millis = (v) => v?.toMillis?.() ?? 0;
const discordLink = (url) => typeof url === 'string' && url.startsWith('https://discord.com/channels/') ? url : null;

function MemberCard({ member, view, today, checkIns, isMe }) {
  const [open, setOpen] = useState(false);
  const s = memberSummary(view, today);
  const month = today.slice(0, 7);
  const rests = view.rest_history.filter((d) => d.startsWith(month));
  const exempts = view.exemptions.filter((d) => d.startsWith(month) && !rests.includes(d));
  const plans = [...iterPlans(view)];
  const offToday = view.rest_history.includes(today) ? '🛌 오늘 휴식' : view.exemptions.includes(today) ? '🛡️ 오늘 면책' : null;
  const latestRecord = (planId) => checkIns.filter((c) => c.planId === planId && c.date === today)
    .sort((a, b) => millis(a.createdAt) - millis(b.createdAt)).at(-1);

  return <li className={`tk-member${isMe ? ' tk-member-me' : ''}`}>
    <button type="button" className="tk-member-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      <strong>{view.display_name || member.displayName || member.id}{isMe && ' (나)'}</strong>
      {!member.uid && <span className="tk-chip tk-chip-muted" title="Planer 앱 미연동 (디스코드만 사용)">디스코드</span>}
      {offToday && <span className="tk-chip">{offToday}</span>}
      <span className="tk-chip">오늘 {s.todayDone}/{s.todayTotal}</span>
      {s.goalsTotal > 0 && <span className="tk-chip">주간·월간 {s.goalsDone}/{s.goalsTotal}</span>}
      {s.limitsOver > 0 && <span className="tk-chip tk-chip-bad">제한 초과 {s.limitsOver}</span>}
      <span className="tk-chip">휴식 {rests.length} · 면책 {exempts.length}</span>
      <span className="tk-chip">💸 {view.fines.toLocaleString()}원</span>
      {s.todayTotal > 0 && <progress value={s.todayDone} max={s.todayTotal} aria-label="오늘 진행도" />}
      <span className="tk-muted">{open ? '접기 ▲' : '자세히 ▼'}</span>
    </button>
    {open && (plans.length ? <ul className="tk-list">{plans.map(([category, plan]) => {
      const [mark, text] = progressLine(view, category, plan, today);
      const link = discordLink(latestRecord(plan.id)?.messageUrl);
      return <li key={plan.id} className="tk-plan">
        <span className="tk-mark">{mark}</span>
        <span className="tk-plan-main"><span className="tk-muted">[{CATEGORY_KR[category]}]</span> {plan.content} <span className="tk-muted">{text}</span>
          {plan.photo && ' 📸'}</span>
        {link && <a className="tk-link" href={link} target="_blank" rel="noreferrer">인증 메시지 보기</a>}
      </li>;
    })}</ul> : <p className="tk-muted">등록된 계획이 없어요.</p>)}
  </li>;
}

export default function MembersTab({ tonkatsu: t, discordId, serverName }) {
  if (t.error) return <p role="alert">멤버 정보를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>;
  if (!t.ready) return <p role="status">멤버 정보를 불러오는 중…</p>;

  const empty = { completed_goals: [], rest_history: [], exemptions: [], fines: 0 };
  const members = [...t.members].sort((a, b) => (a.id === discordId ? -1 : b.id === discordId ? 1 : 0)
    || (a.displayName || '').localeCompare(b.displayName || '', 'ko'));
  const nameOf = (id) => t.views[String(id)]?.display_name || t.members.find((m) => m.id === String(id))?.displayName || '알 수 없음';
  const ranking = members.filter((m) => (t.views[m.id]?.fines || 0) > 0).sort((a, b) => t.views[b.id].fines - t.views[a.id].fines);

  return <div className="tk">
    <h2 className="tk-title">👥 {serverName || '멤버'} 진행 상황 <span className="tk-muted">{t.today} 기준</span></h2>

    {t.votes.length > 0 && <section className="tk-card">
      <h3>🛡️ 진행 중인 면책 투표</h3>
      <ul className="tk-fines">{t.votes.map((v) => <li key={v.id}>
        <strong>{nameOf(v.target_id)}</strong>
        <span>{(v.target_dates || []).length > 1 ? `${v.target_dates[0]} ~ ${v.target_dates.at(-1)}` : v.target_dates?.[0]}</span>
        <span>찬성 {(v.agreed_users || []).length}/{v.required_votes} · 반대 {(v.denied_users || []).length}</span>
        {v.reason && <span className="tk-muted">{v.reason}</span>}
      </li>)}</ul>
      <p className="tk-muted">투표는 디스코드 메시지의 버튼으로 해요.</p>
    </section>}

    <ul className="tk-members">{members.map((m) =>
      <MemberCard key={m.id} member={m} view={t.views[m.id] || empty} today={t.today} checkIns={t.checkIns} isMe={m.id === discordId} />)}</ul>

    {ranking.length > 0 && <section className="tk-card">
      <h3>🏆 명예의 전당 (누적 벌금)</h3>
      <ol className="tk-rank">{ranking.map((m) => <li key={m.id}>{nameOf(m.id)} <strong>{t.views[m.id].fines.toLocaleString()}원</strong></li>)}</ol>
    </section>}
  </div>;
}
