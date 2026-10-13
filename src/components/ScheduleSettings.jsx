import { useEffect, useRef, useState } from 'react';
import { saveScheduleSettings } from '../features/planner/scheduleSettings';
import { plannerDate, rangeForDate } from '../features/planner/scheduleTime.mjs';
import { oppositeDisplayFromHistory } from '../features/planner/oppositeDisplay.mjs';
export default function ScheduleSettings({ uid, history, ready, error, onClose }) {
  const current = rangeForDate(history, plannerDate());
  const display = oppositeDisplayFromHistory(history);
  const [startHour, setStartHour] = useState(current.startHour);
  const [endHour, setEndHour] = useState(current.endHour);
  const [plannerOppositeDisplay, setPlannerOppositeDisplay] = useState(display.plannerOppositeDisplay);
  const [controlOppositeDisplay, setControlOppositeDisplay] = useState(display.controlOppositeDisplay);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  const save = async e => {
    e.preventDefault();
    if (saving || !ready || error) return;
    setSaving(true); setFailure('');
    try { await saveScheduleSettings(uid, { startHour, endHour, plannerOppositeDisplay, controlOppositeDisplay }); onClose(); }
    catch { setFailure('설정을 저장하지 못했습니다. 연결 상태와 Firebase 접근 규칙을 확인해 주세요.'); }
    finally { setSaving(false); }
  };
  const options = Array.from({length:24}, (_,h) => <option key={h} value={h}>{String(h).padStart(2,'0')}:00</option>);
  const displayOptions = <><option value="all">모두 표시</option><option value="faded">흐릿하게</option><option value="blind">블라인드</option><option value="hidden">투명화</option></>;
  return <dialog ref={dialog} className="schedule-settings" onCancel={e => { if(saving) e.preventDefault(); else onClose(); }}>
    <form onSubmit={save}>
      <h2>캘린더 설정</h2>
      <p>달력에 표시할 하루의 시간 범위</p>
      <div className="schedule-settings-hours">
        <label>시작 <select value={startHour} onChange={e => setStartHour(Number(e.target.value))} disabled={saving}>{options}</select></label>
        <label>종료 {endHour <= startHour && '(다음 날)'} <select value={endHour} onChange={e => setEndHour(Number(e.target.value))} disabled={saving}>{options}</select></label>
      </div>
      <p>시간 범위 변경은 오늘부터 적용됩니다. 이전 날짜의 시간 범위와 모든 기록은 유지됩니다. 새 범위 밖에 기록이 있으면 해당 시간도 표시합니다.</p>
      <p>새벽 5시 전은 전날로 표시·기록하는 기존 기준을 유지합니다. 시작과 종료가 같으면 24시간을 표시합니다.</p>
      <div className="schedule-settings-display">
        <h3>반대편 탭의 블록 표시</h3>
        <label>시간 관리 탭에서 통제 블록
          <select value={plannerOppositeDisplay} onChange={e => setPlannerOppositeDisplay(e.target.value)} disabled={saving}>{displayOptions}</select>
        </label>
        <label>통제 탭에서 공부 블록
          <select value={controlOppositeDisplay} onChange={e => setControlOppositeDisplay(e.target.value)} disabled={saving}>{displayOptions}</select>
        </label>
        <p>모두 표시는 원래 색과 이름을, 흐릿하게는 색과 이름을 옅게, 블라인드는 연한 회색으로 표시합니다. 투명화는 반대편 블록을 보이지 않게 합니다. 저장 즉시 모든 날짜에 적용됩니다.</p>
      </div>
      {(!ready || error || failure) && <p role="alert">{failure || (error ? '설정을 불러오지 못했습니다. Firebase 규칙에 plannerSettings 접근 허용이 필요합니다.' : '설정을 불러오는 중…')}</p>}
      <div className="schedule-settings-actions">
        <button type="button" className="btn-signout" onClick={onClose} disabled={saving}>취소</button>
        <button type="submit" className="btn btn-login" disabled={saving || !ready || !!error}>{saving ? '저장 중…' : '저장'}</button>
      </div>
    </form>
  </dialog>;
}
