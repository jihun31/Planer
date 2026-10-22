import { useEffect, useState } from 'react';
import { dateShift, duration, editorGoalConfiguration, goalEffectiveDate, goalForDate, learningStats, validGoal, weekStart } from '../../features/learning/learningStats.mjs';
import { isStudyBlock } from '../../features/planner/blockKind.mjs';
import { archivedActivityReferences } from '../../features/learning/archivedActivity.mjs';
import { hasVisibleModal, isEditingTarget } from '../../features/navigation/keyboardShortcuts.mjs';
import { badgeTier, tierLabel } from '../../features/learning/badgeAppearance.mjs';
import LearningMedal from '../learning/LearningMedal.jsx';
import LearningBadgeFrame from '../learning/LearningBadgeFrame.jsx';
import PersonalRecords from '../learning/PersonalRecords.jsx';
import '../../styles/learning.css';

const shortDate = date => `${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`;
const weekdays = ['월','화','수','목','금','토','일'];
const remainingTime = minutes => `${Math.floor(minutes/60)}시간 ${minutes%60}분`;
function highlightCaption(badge) {
  if (!badge.repeated) return '새 배지 획득';
  if (badge.remaining === null) return '최고 목표 달성';
  return `다음 목표까지 ${badge.type === 'week' ? remainingTime(badge.remaining) : `${badge.remaining}일`}`;
}

export function LearningSummary({ learning, onOpen }) {
  const { stats:s, ready, error } = learning;
  return <button className="learning-summary" onClick={onOpen} type="button">
    <span className="learning-summary-title">학습 기록</span>
    {!ready ? <span>기록을 불러오는 중…</span> : error ? <span>기록 연결 확인이 필요해요</span> : <>
      <strong>{s.streak ? `${s.streak}일 연속 학습중` : '오늘부터 학습을 이어가세요'}</strong>
      <span>오늘 {duration(s.todayMinutes)}{s.goal ? ` / 목표 ${duration(s.goal.minutes)}` : ' · 목표 설정하기'}</span>
      {s.goal && <progress aria-label="오늘 학습 목표" value={Math.min(s.todayMinutes,s.goal.minutes)} max={s.goal.minutes} />}
    </>}
    <span className="learning-summary-link">자세히 보기 →</span>
  </button>;
}

export default function LearningTab({ learning, active = false }) {
  const { stats:s, history, blocks, activities, ready, error, saveGoal, setCustomLearning,
    permanentlyDeleteArchivedActivity } = learning;
  const [weekOffset,setWeekOffset] = useState(0);
  useEffect(() => {
    if (!active) return;
    const onKeyDown = event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey
        || event.shiftKey || isEditingTarget(event.target) || hasVisibleModal()) return;
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setWeekOffset(current => event.key === 'ArrowLeft' ? current - 1 : Math.min(0, current + 1));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);
  const [editing,setEditing] = useState(false);
  const [minutes,setMinutes] = useState('60');
  const [includedIds,setIncludedIds] = useState([]);
  const [targets,setTargets] = useState({});
  const [lastSavedGoal,setLastSavedGoal] = useState(null);
  const [showCustomRecords,setShowCustomRecords] = useState(false);
  const [visibleCustomCount,setVisibleCustomCount] = useState(50);
  const [customBusy,setCustomBusy] = useState(null);
  const [archiveBusyId,setArchiveBusyId] = useState(null);
  const [saving,setSaving] = useState(false);
  const [message,setMessage] = useState('');
  const [saveError,setSaveError] = useState('');
  const week = dateShift(weekStart(s.today),weekOffset*7);
  const selectedWeekMinutes = s.weeks[week] || 0;
  const selectedWeekBadge = s.badges.filter(b => b.type === 'week' && selectedWeekMinutes >= b.target)
    .sort((a,b) => b.target-a.target)[0];
  const selectedWeekTier = selectedWeekBadge && badgeTier(selectedWeekBadge.type,selectedWeekBadge.target);
  const weekTopActivities = s.weekTopActivities[week] || [];
  const dates = Array.from({length:7},(_,i) => dateShift(week,i));
  const maxMinutes = Math.max(60, ...dates.map(d => s.days[d]?.minutes || 0));
  const nextWeek = dateShift(weekStart(s.today),7);
  const pending = goalForDate(history,nextWeek);
  const selection = editorGoalConfiguration(history,lastSavedGoal);
  const customBlocks = blocks.filter(block => isStudyBlock(block) && !block.activityId
    && typeof block.id === 'string' && typeof block.date === 'string')
    .sort((a,b) => b.date.localeCompare(a.date) || (b.startMin ?? 0)-(a.startMin ?? 0));
  const draftTargets = Object.fromEntries(includedIds.flatMap(id => {
    const value = String(targets[id] ?? '').trim();
    return value && validGoal(Number(value)) ? [[id,Number(value)]] : [];
  }));
  const preview = editing && !selection && validGoal(Number(minutes))
    ? learningStats(blocks,[...history,{
      minutes:Number(minutes), effectiveDate:goalEffectiveDate(history,s.today),
      includedActivityIds:includedIds, activityTargets:draftTargets, changedAt:Date.now(),
    }]) : null;
  const heatStart = dateShift(weekStart(s.today),-42);
  const nextWeeklyBadge = s.badges.find(b => b.type === 'week' && b.target > s.weekMinutes);
  function toggleEditor() {
    if (editing) { setEditing(false); return; }
    setMinutes(String(selection?.minutes ?? pending?.minutes ?? s.goal?.minutes ?? 60));
    const availableIds = new Set(activities.map(activity => activity.id));
    setIncludedIds(selection ? selection.includedActivityIds.filter(id => availableIds.has(id)) : activities.map(a => a.id));
    setTargets(selection ? { ...selection.activityTargets } : {});
    setSaveError(''); setMessage(''); setEditing(true);
  }
  function toggleActivity(id) {
    setIncludedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current,id]);
  }
  async function submit(event) {
    event.preventDefault();
    setSaving(true); setSaveError(''); setMessage('');
    try {
      const activityTargets = {};
      for (const id of includedIds) {
        const value = String(targets[id] ?? '').trim();
        if (!value) continue;
        if (!validGoal(Number(value))) throw new Error('활동별 목표를 확인해 주세요.');
        activityTargets[id] = Number(value);
      }
      const saved = await saveGoal(Number(minutes),includedIds,activityTargets);
      setLastSavedGoal(saved);
      setMessage(`${saved.effectiveDate}부터 하루 ${duration(saved.minutes)} 목표가 적용됩니다.${selection ? '' : ' 첫 활동 선택은 과거 기록에도 적용됩니다.'}`);
      setEditing(false);
    } catch (err) {
      setSaveError(err.code === 'permission-denied' ? '목표를 저장하려면 Firebase의 새 학습 기록 규칙을 먼저 적용해 주세요.' : err.message || '저장하지 못했습니다. 입력값과 인터넷 연결을 확인해 주세요.');
    } finally { setSaving(false); }
  }
  async function toggleCustomBlock(block) {
    setCustomBusy(block.id); setSaveError('');
    try { await setCustomLearning(block.id,block.learningIncluded !== true); }
    catch { setSaveError('직접 입력 기록의 학습 포함 여부를 저장하지 못했습니다.'); }
    finally { setCustomBusy(null); }
  }
  async function purgeArchivedActivity(activity) {
    const references = archivedActivityReferences(blocks,activity.id).length;
    if (!window.confirm(`보관된 활동 '${activity.name}'을 영구 삭제할까요? 연결된 과거 기록 ${references}개에는 활동 이름과 색을 남깁니다. 이 삭제는 되돌릴 수 없습니다.`)) return;
    setArchiveBusyId(activity.id); setSaveError(''); setMessage('');
    try {
      await permanentlyDeleteArchivedActivity(activity.id);
      setIncludedIds(current => current.filter(id => id !== activity.id));
      setTargets(current => { const next = { ...current }; delete next[activity.id]; return next; });
      setMessage(`'${activity.name}'을 영구 삭제했습니다. 과거 기록은 유지됩니다.`);
    } catch (err) {
      setSaveError(err.message || '보관된 활동을 삭제하지 못했습니다. 다시 시도해 주세요.');
    } finally { setArchiveBusyId(null); }
  }
  if (!ready) return <p role="status" className="learning-notice">학습 기록을 불러오는 중…</p>;
  if (error) return <div className="learning-notice" role="alert">
    <h2>학습 기록을 불러오지 못했습니다</h2>
    <p>{error.code === 'permission-denied' ? 'Firebase 콘솔에서 새 learningGoals 규칙을 적용한 뒤 다시 시도해 주세요.' : '인터넷 연결을 확인한 뒤 다시 시도해 주세요.'}</p>
    <button type="button" className="learning-button" onClick={learning.retry}>다시 시도</button>
  </div>;
  return <div className="learning-page">
    <header className="learning-heading">
      <div><h1>학습 기록</h1><p className="learning-eyebrow">차곡차곡 쌓이는 나의 시간</p></div>
      <button className="learning-button" type="button" onClick={toggleEditor}>{editing ? '닫기' : s.goal ? `하루 목표 ${duration(s.goal.minutes)} · 변경` : '하루 목표 설정'}</button>
    </header>
    {editing && <form className="learning-goal" onSubmit={submit}>
      <div className="learning-goal-intro"><strong>나의 학습일 기준</strong><p>선택한 활동의 합계가 하루 목표에 도달하면 학습일로 기록됩니다. 하루는 오전 5시에 시작합니다.</p>
        <p>{history.length ? '하루 목표 변경은 다음 주 월요일부터 적용됩니다.' : '첫 하루 목표는 기존 학습 기록에도 적용됩니다.'} {selection ? '활동 선택 변경도 다음 주부터 적용됩니다.' : '첫 활동 선택은 과거 기록에도 적용됩니다.'}</p></div>
      <div className="learning-goal-actions"><label>하루 <input type="number" min="5" max="1440" step="1" value={minutes} onChange={e => setMinutes(e.target.value)} required disabled={saving} /> 분</label>
        <button className="learning-button learning-primary" disabled={saving}>{saving ? '저장 중…' : '목표 저장'}</button></div>
      <div className="learning-activity-settings">
        <div className="learning-activity-heading"><strong>학습에 포함할 활동</strong><span>활동별 하루 목표는 선택 사항</span></div>
        {activities.length ? <div className="learning-activity-list">{activities.map(activity => <div className="learning-activity-row" key={activity.id}>
          <label><input type="checkbox" checked={includedIds.includes(activity.id)} onChange={() => toggleActivity(activity.id)} disabled={saving} />
            <span className="learning-activity-dot" style={{background:activity.color || '#6b7280'}} />{activity.name}{activity.archived && <small>보관됨</small>}</label>
          <span className="learning-activity-today">오늘 {duration(s.activityMinutes[activity.id] || 0)}</span>
          <label className="learning-activity-target">목표 <input type="number" min="5" max="1440" step="1" placeholder="선택" aria-label={`${activity.name} 하루 목표(분)`}
            value={targets[activity.id] ?? ''} onChange={e => setTargets(current => ({...current,[activity.id]:e.target.value}))}
            disabled={saving || !includedIds.includes(activity.id)} /> 분</label>
          {activity.archived && <button type="button" className="learning-purge" onClick={() => purgeArchivedActivity(activity)}
            disabled={!!archiveBusyId || saving}>영구 삭제</button>}
        </div>)}</div> : <p>시간 관리 탭에서 활동을 등록하면 여기에서 선택할 수 있습니다.</p>}
        {preview && <p className="learning-goal-preview">첫 활동 선택을 과거에 적용하면 이번 주 학습 시간이 {duration(s.weekMinutes)} → {duration(preview.weekMinutes)}로 바뀝니다.</p>}
        <p>활동별 목표는 각 활동의 진행도를 확인하는 기준입니다. 학습일 달성 여부는 위의 하루 합계 목표로 판단합니다.</p>
      </div>
      {customBlocks.length > 0 && <div className="learning-custom-settings">
        <button type="button" className="learning-custom-toggle" onClick={() => setShowCustomRecords(value => !value)}>
          직접 입력·미분류 기록 검토 {customBlocks.length}개 {showCustomRecords ? '접기' : '펼치기'}
        </button>
        {showCustomRecords && <><p>활동을 등록하지 않고 입력한 기록은 아래에서 하나씩 학습에 포함할 수 있습니다. 첫 활동 선택을 저장하면 체크하지 않은 기존 직접 입력 기록은 학습 시간에서 제외됩니다. 선택은 즉시 저장됩니다.</p>
          <div className="learning-custom-list">{customBlocks.slice(0,visibleCustomCount).map(block => <label key={block.id}>
            <input type="checkbox" checked={block.learningIncluded === true}
              onChange={() => toggleCustomBlock(block)} disabled={customBusy === block.id} />
            <span>{block.date} · {block.customName || block.activityName || '직접 입력'}</span>
          </label>)}</div>
          {visibleCustomCount < customBlocks.length && <button type="button" className="learning-button" onClick={() => setVisibleCustomCount(count => count+50)}>더 보기</button>}
        </>}
      </div>}
    </form>}
    {pending && pending.effectiveDate > s.today && <p className="learning-inline-note">예약된 목표: {pending.effectiveDate}부터 하루 {duration(pending.minutes)}</p>}
    {message && <p role="status" className="learning-inline-note">{message}</p>}
    {saveError && <p role="alert">{saveError}</p>}
    <section className="learning-metrics" aria-label="학습 요약">
      <article className="learning-metric learning-streak"><span>지금 이어가는 기록</span><strong>{s.streak}<small>일 연속 학습중</small></strong><p>{s.days[s.today]?.achieved ? '오늘 목표까지 달성했어요' : s.streak ? '오늘 목표를 채워 기록을 이어가세요' : '하루 목표를 달성하며 시작해 보세요'}</p></article>
      <article className="learning-metric"><span>이번 주 학습</span><strong>{duration(s.weekMinutes)}</strong><p>월요일부터 오늘까지</p></article>
      <article className="learning-metric learning-week-achievements"><span>이번 주 성과</span>
        {s.weekHighlights.length ? <div className="learning-highlight-list">{s.weekHighlights.map(b => <div className="learning-highlight" key={b.id}>
          <LearningMedal tier={badgeTier(b.type,b.target)} />
          <div><strong>{b.label}</strong><small className={b.repeated && b.remaining !== null ? 'learning-highlight-remaining' : undefined}>{highlightCaption(b)}</small></div>
        </div>)}</div> : <><strong>{nextWeeklyBadge ? `${duration(nextWeeklyBadge.target - s.weekMinutes)} 남음` : '이번 주를 시작해 보세요'}</strong>
          <p>{nextWeeklyBadge ? `${nextWeeklyBadge.label} 배지까지` : '학습을 기록하면 성과가 표시됩니다'}</p></>}
        <a href="#learning-badges" className="learning-highlight-link">전체 배지 보기 →</a>
      </article>
    </section>
    <div className="learning-charts">
      <section className="learning-card learning-week-card">
        <div className="learning-card-heading learning-week-heading">
          <div className="learning-week-title">
            <div className="learning-week-title-row"><h2>한 주의 학습</h2>
              {selectedWeekBadge && <div className={`learning-week-badge learning-badge-${selectedWeekTier}`}>
                <LearningMedal tier={selectedWeekTier} /><strong>{selectedWeekBadge.label}</strong>
              </div>}
            </div>
            <p>{shortDate(week)} – {shortDate(dateShift(week,6))} · {duration(selectedWeekMinutes)}</p>
          </div>
          <div className="learning-week-nav"><button type="button" aria-label="이전 주" onClick={() => setWeekOffset(v => v-1)}>‹</button>
            <button type="button" onClick={() => setWeekOffset(0)} disabled={!weekOffset}>이번 주</button>
            <button type="button" aria-label="다음 주" disabled={weekOffset === 0} onClick={() => setWeekOffset(v => Math.min(0,v+1))}>›</button></div>
        </div>
        <div className="learning-bars" role="img" aria-label={dates.map((d,i) => `${weekdays[i]} ${duration(s.days[d]?.minutes || 0)}`).join(', ')}>
          {dates.map((d,i) => <div className={`learning-bar-column ${d === s.today ? 'is-today' : ''}`} key={d}>
            <span className="learning-bar-value">{d > s.today ? '—' : duration(s.days[d]?.minutes || 0)}</span>
            <div className="learning-bar-track"><div className={s.days[d]?.achieved ? 'is-achieved' : ''} style={{height:`${(s.days[d]?.minutes || 0)/maxMinutes*100}%`}} /></div>
            <span>{weekdays[i]}{s.days[d]?.achieved ? ' ✓' : ''}</span><small>{shortDate(d)}</small>
          </div>)}
        </div>
        <p className="learning-caption">초록색은 그날의 목표를 달성한 기록입니다.</p>
        <div className="learning-week-activities">
          <span className="learning-week-activities-label">이 주의 활동:</span>
          {weekTopActivities.length > 0 ? <ol aria-label="선택한 주에 가장 많이 한 활동 3개">
            {weekTopActivities.map(activity => <li key={activity.key}>
              <span className="learning-week-activity-dot" style={{background:activity.color}} />
              <span className="learning-week-activity-name" title={activity.name}>{activity.name}</span>
              <span className="learning-week-activity-time">{duration(activity.minutes)}</span>
            </li>)}
          </ol> : <span className="learning-week-activity-empty">기록 없음</span>}
        </div>
      </section>
      <section className="learning-card"><div className="learning-card-heading"><div><h2>꾸준함의 흔적</h2><p>최근 7주</p></div></div>
        <div className="learning-heatmap">
          <table aria-label="최근 7주 학습 기록 달력"><thead><tr><th scope="col">주</th>{weekdays.map(d => <th scope="col" key={d}>{d}</th>)}</tr></thead>
            <tbody>{Array.from({length:7},(_,w) => <tr key={w}><th scope="row">{shortDate(dateShift(heatStart,w*7))}</th>{Array.from({length:7},(_,d) => {
              const date = dateShift(heatStart,w*7+d), day = s.days[date];
              const label = `${weekdays[d]}요일: ${date > s.today ? '아직 지나지 않은 날' : `${duration(day?.minutes || 0)}${day?.achieved ? ', 목표 달성' : ''}`}`;
              return <td tabIndex={0} aria-label={`${date} ${label}`} title={label} key={date} className={`learning-heat-cell ${date === s.today ? 'is-today' : ''} ${date > s.today ? 'is-future' : day?.achieved ? 'is-achieved' : day?.minutes ? 'is-recorded' : ''}`} />;
            })}</tr>)}</tbody>
          </table>
        </div>
        <p className="learning-legend"><span>□ 기록 없음</span><span>▧ 학습 기록</span><span>🟩 목표 달성</span></p>
      </section>
    </div>
    <PersonalRecords records={s.personalRecords} />
    <section className="learning-card learning-badges" id="learning-badges"><div className="learning-card-heading"><div><h2>나의 배지 <span>{s.badges.filter(b => b.earnedDate).length} / {s.badges.length}</span></h2><p>목표 달성일 총 {s.qualifiedCount}일 · 최장 {s.bestStreak}일 연속</p></div></div>
      {['week','streak'].map(type => <div className="learning-badge-group" key={type}>
        <h3>{type === 'week' ? '한 주의 몰입' : '꾸준한 발걸음'}</h3>
        <div className={`learning-badge-grid learning-badge-grid-${type}`}>{s.badges.filter(b => b.type === type).sort((a,b) => b.target-a.target).map(b => {
          const tier = badgeTier(b.type,b.target);
          return <article key={b.id} className={`learning-badge learning-badge-${tier} ${b.earnedDate ? 'is-earned' : ''}`}>
          <LearningBadgeFrame tier={tier} />
          <span className="learning-badge-tier">{tierLabel[tier]}</span>
          <span className="learning-badge-icon"><LearningMedal tier={tier} /></span><strong>{b.label}</strong>
          <small>{b.earnedDate ? `${b.lastEarnedDate} 달성` : type === 'week' ? `이번 주 ${duration(b.progress)}` : `현재 ${b.progress} / ${b.target}일`}</small>
          <progress aria-label={`${b.label} 진행도`} max={b.target} value={b.earnedDate ? b.target : Math.min(b.progress,b.target)} />
        </article>; })}</div>
      </div>)}
      <p className="learning-caption">저장된 학습 시간만 반영하며, 겹치는 시간은 한 번만 계산합니다. 기록을 수정하거나 삭제하면 배지와 연속 기록도 다시 계산됩니다.</p>
    </section>
  </div>;
}
