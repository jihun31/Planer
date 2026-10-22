import { useEffect, useRef, useState } from 'react';
import { gapClock } from '../../features/planner/studyGap.mjs';
import { saveStudyGap } from '../../features/planner/studyGapService';

export default function StudyGapDialog({uid,gap,onContinue,onRetry}) {
  const dialog = useRef(null), busyRef = useRef(false);
  const [activityId,setActivityId] = useState('');
  const [name,setName] = useState('');
  const [group,setGroup] = useState('controlled');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  useEffect(() => {if (!dialog.current.open) dialog.current.showModal();},[]);
  const activities = gap.activities || [];
  const custom = activityId === '__custom__';
  async function save(event) {
    event.preventDefault();
    if (busyRef.current) return;
    const activity = activities.find(item => item.id === activityId);
    if ((!custom && !activity) || (custom && !name.trim())) return;
    busyRef.current = true;setBusy(true);setError('');
    try {
      await saveStudyGap(uid,gap,custom ? {activityId:null,customName:name.trim(),group}
        : {activityId:activity.id,activityName:activity.name,group:activity.group || 'controlled'});
      onContinue();
    } catch {setError('빈 시간을 저장하지 못했습니다. 다시 시도하거나 건너뛰어 주세요.');}
    finally {busyRef.current = false;setBusy(false);}
  }
  return <dialog ref={dialog} className="study-gap-dialog" aria-labelledby="study-gap-title"
    onCancel={event => {event.preventDefault();if (!busyRef.current) onContinue();}}>
    <h2 id="study-gap-title">학습 사이 빈 시간 기록</h2>
    <p>시작 버튼을 누른 시각부터 학습 시간을 계산합니다.</p>
    {gap.error ? <>
      <p role="alert">이전 기록을 확인하지 못했습니다. 다시 확인하거나 빈 시간 기록을 건너뛸 수 있습니다.</p>
      <div className="study-gap-actions"><button type="button" onClick={onContinue}>건너뛰고 시작</button>
        <button type="button" onClick={onRetry}>다시 확인</button></div>
    </> : <form onSubmit={save}>
      <div className="study-gap-ranges">{gap.segments.map(segment => <span key={segment.startMin}>
        {gapClock(segment.date,segment.startMin)}–{gapClock(segment.date,segment.endMin)}
      </span>)}<strong>총 {gap.segments.reduce((total,segment) => total + segment.endMin - segment.startMin,0)}분</strong></div>
      <label>통제 활동<select value={activityId} disabled={busy} onChange={event => setActivityId(event.target.value)}>
        <option value="">활동 선택</option>
        {activities.map(activity => <option key={activity.id} value={activity.id}>{activity.group === 'foolish' ? '어리석음' : '통제'} · {activity.name}</option>)}
        <option value="__custom__">직접 입력</option>
      </select></label>
      {custom && <div className="study-gap-custom"><label>활동명<input maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} required /></label>
        <label>그룹<select value={group} disabled={busy} onChange={event => setGroup(event.target.value)}><option value="controlled">통제</option><option value="foolish">어리석음</option></select></label></div>}
      {error && <p role="alert">{error}</p>}
      <div className="study-gap-actions"><button type="button" disabled={busy} onClick={onContinue}>건너뛰고 시작</button>
        <button type="submit" className="study-gap-primary" disabled={busy || !activityId || custom && !name.trim()}>{busy ? '저장 중…' : '기록하고 시작'}</button></div>
    </form>}
  </dialog>;
}
