import { useEffect, useRef, useState } from 'react';
import { saveScheduleSettings } from '../features/planner/scheduleSettings';
import { plannerDate, rangeForDate } from '../features/planner/scheduleTime.mjs';
import { oppositeDisplayFromHistory } from '../features/planner/oppositeDisplay.mjs';
import { useTimerPopupPreference, useStudyGapPreference, useTimerPopupPosition } from '../features/planner/timerPreferences';
import { useTabVisibility } from '../features/navigation/useTabVisibility';
import { useEditableCopy } from '../features/copy/useEditableCopy';
export default function ScheduleSettings({ uid, history, ready, error, onClose }) {
  const copy = useEditableCopy('settings');
  const close = () => {if (!saving && copy.canClose()) onClose();};
  const [timerPopupEnabled, setTimerPopupEnabled] = useTimerPopupPreference(uid);
  const [timerPopupPosition, setTimerPopupPosition] = useTimerPopupPosition(uid);
  const [studyGapEnabled, setStudyGapEnabled] = useStudyGapPreference(uid);
  const [timerFailure, setTimerFailure] = useState('');
  const [tabVisibility,setTabVisible] = useTabVisibility(uid);
  const [tabFailure,setTabFailure] = useState('');
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
    if (saving || copy.editing || !ready || error) return;
    setSaving(true); setFailure('');
    try { await saveScheduleSettings(uid, { startHour, endHour, plannerOppositeDisplay, controlOppositeDisplay }); onClose(); }
    catch { setFailure('설정을 저장하지 못했습니다. 연결 상태와 Firebase 접근 규칙을 확인해 주세요.'); }
    finally { setSaving(false); }
  };
  const options = Array.from({length:24}, (_,h) => <option key={h} value={h}>{String(h).padStart(2,'0')}:00</option>);
  const displayOptions = <><option value="all">{copy.value('displayAll')}</option><option value="faded">{copy.value('displayFaded')}</option><option value="hidden">{copy.value('displayHidden')}</option><option value="blind">{copy.value('displayBlind')}</option></>;
  return <dialog ref={dialog} className="schedule-settings" onCancel={e => {e.preventDefault();close();}}>
    <div className="settings-dialog-heading"><h2>{copy.field('title')}</h2><div inert={saving ? true : undefined}>{copy.actions}</div></div>
    {copy.status}
    <section className="schedule-settings-timer">
      <h3>{copy.field('timerHeading')}</h3>
      <label>{copy.field('timerPopup')}<input type="checkbox" disabled={copy.editing} checked={timerPopupEnabled} onChange={e => {
        try { setTimerPopupEnabled(e.target.checked); setTimerFailure(''); }
        catch { setTimerFailure('타이머 설정을 저장하지 못했습니다. 이 기기의 저장 공간 접근을 확인해 주세요.'); }
      }} /></label>
      <label>{copy.field('timerPopupPosition')}<select value={timerPopupPosition} disabled={copy.editing} onChange={e => {
        try {setTimerPopupPosition(e.target.value);setTimerFailure('');}
        catch {setTimerFailure('타이머 설정을 저장하지 못했습니다. 이 기기의 저장 공간 접근을 확인해 주세요.');}
      }}>
        <option value="left">{copy.value('timerPopupLeft')}</option>
        <option value="right">{copy.value('timerPopupRight')}</option>
      </select></label>
      <label>{copy.field('studyGap')}<input type="checkbox" disabled={copy.editing} checked={studyGapEnabled} onChange={e => {
        try { setStudyGapEnabled(e.target.checked); setTimerFailure(''); }
        catch { setTimerFailure('타이머 설정을 저장하지 못했습니다. 이 기기의 저장 공간 접근을 확인해 주세요.'); }
      }} /></label>
      <p>{copy.field('studyGapNote')}</p>
      {timerFailure && <p role="alert">{timerFailure}</p>}
    </section>
    <section className="schedule-settings-timer">
      <h3>{copy.field('tabsHeading')}</h3>
      {['control','notes','calendar'].map(tab => <label key={tab}>{copy.field(`${tab}Tab`)}
        <input type="checkbox" disabled={copy.editing} checked={tabVisibility[tab]} onChange={event => {
          try {setTabVisible(tab,event.target.checked);setTabFailure('');}
          catch {setTabFailure('탭 설정을 저장하지 못했습니다. 이 기기의 저장 공간 접근을 확인해 주세요.');}
        }} />
      </label>)}
      {tabFailure && <p role="alert">{tabFailure}</p>}
    </section>
    <form onSubmit={save}>
      <h3 className="schedule-settings-calendar-title">{copy.field('calendarHeading')}</h3>
      <p>{copy.field('rangeNote')}</p>
      <div className="schedule-settings-hours">
        <label>{copy.field('start')} <select value={startHour} onChange={e => setStartHour(Number(e.target.value))} disabled={saving || copy.editing}>{options}</select></label>
        <label>{copy.field('end')} <select value={endHour} onChange={e => setEndHour(Number(e.target.value))} disabled={saving || copy.editing}>{options}</select></label>
      </div>
      <p>{copy.field('rangeHistory')}</p>
      {(copy.editing || copy.value('dayBoundary')) && <p>{copy.field('dayBoundary')}</p>}
      <div className="schedule-settings-display">
        <h3>{copy.field('oppositeHeading')}</h3>
        <label>{copy.field('plannerOpposite')}
          <select value={plannerOppositeDisplay} onChange={e => setPlannerOppositeDisplay(e.target.value)} disabled={saving || copy.editing}>{displayOptions}</select>
        </label>
        <label>{copy.field('controlOpposite')}
          <select value={controlOppositeDisplay} onChange={e => setControlOppositeDisplay(e.target.value)} disabled={saving || copy.editing}>{displayOptions}</select>
        </label>
      </div>
      {copy.editing && <div className="copy-option-editor"><p>선택 항목·버튼 문구</p>
        {['timerPopupLeft','timerPopupRight','displayAll','displayFaded','displayHidden','displayBlind','close','save','saving'].map(key => <div key={key}>{copy.field(key)}</div>)}
      </div>}
      {(!ready || error || failure) && <p role="alert">{failure || (error ? '설정을 불러오지 못했습니다. Firebase 규칙에 plannerSettings 접근 허용이 필요합니다.' : '설정을 불러오는 중…')}</p>}
      <div className="schedule-settings-actions">
        <button type="button" className="btn-signout" onClick={close} disabled={saving || copy.busy}>{copy.value('close')}</button>
        <button type="submit" className="btn btn-login" disabled={saving || copy.editing || !ready || !!error}>{copy.value(saving ? 'saving' : 'save')}</button>
      </div>
    </form>
  </dialog>;
}
