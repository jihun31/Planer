import { useEffect, useRef, useState } from 'react';
import { saveScheduleSettings } from '../features/planner/scheduleSettings';
import { plannerDate, rangeForDate } from '../features/planner/scheduleTime.mjs';
import { oppositeDisplayFromHistory } from '../features/planner/oppositeDisplay.mjs';
import { useTimerPopupPreference, useTimerCompactPreference, useStudyGapPreference, useTimerPopupPosition, useTimerSwitchPreference,
  useFlowRestPreference } from '../features/planner/timerPreferences';
import { useTabVisibility } from '../features/navigation/useTabVisibility';
import { useTabOrder } from '../features/navigation/useTabOrder';
import { DEFAULT_TAB_ORDER, moveTab, orderTabs, tabAvailable, tabViews } from '../features/navigation/appTabs.mjs';
import { useEditableCopy } from '../features/copy/useEditableCopy';
import DiscordLinkSection from './DiscordLinkSection';
import { useSettingHelp } from './SettingHelp';
export default function ScheduleSettings({ uid, history, ready, error, onClose, discord, serverInfo }) {
  const copy = useEditableCopy('settings');
  const help = useSettingHelp(copy.editing);
  const labelWithHelp = (labelKey, noteKey) => <span className="setting-help-label">{copy.field(labelKey)}{help.button(noteKey, copy.value(labelKey))}</span>;
  const close = () => {if (!saving && copy.canClose()) onClose();};
  const [timerPopupEnabled, setTimerPopupEnabled] = useTimerPopupPreference(uid);
  const [timerCompactEnabled, setTimerCompactEnabled] = useTimerCompactPreference(uid);
  const [timerPopupPosition, setTimerPopupPosition] = useTimerPopupPosition(uid);
  const [studyGapEnabled, setStudyGapEnabled] = useStudyGapPreference(uid);
  const [timerSwitchEnabled, setTimerSwitchEnabled] = useTimerSwitchPreference(uid);
  const [flowRestEnabled, setFlowRestEnabled] = useFlowRestPreference(uid);
  const [timerFailure, setTimerFailure] = useState('');
  const saveTimerPreference = apply => {
    try { apply(); setTimerFailure(''); }
    catch { setTimerFailure('타이머 설정을 저장하지 못했습니다. 이 기기의 저장 공간 접근을 확인해 주세요.'); }
  };
  const [tabVisibility,setTabVisible] = useTabVisibility(uid);
  const [tabFailure,setTabFailure] = useState('');
  const [tabOrder,setTabOrder] = useTabOrder(uid);
  const orderContext = { discord: Boolean(discord?.link?.discordId) };
  const orderedTabs = orderTabs(tabOrder).filter(tab => tabAvailable(tab,orderContext));
  const shownTabIds = orderedTabs.map(tab => tab.id);
  const isDefaultOrder = shownTabIds.join() === DEFAULT_TAB_ORDER.filter(id => shownTabIds.includes(id)).join();
  const saveTabVisible = (id,visible) => {
    try {setTabVisible(id,visible);setTabFailure('');}
    catch {setTabFailure('탭 설정을 저장하지 못했습니다. 이 기기의 저장 공간 접근을 확인해 주세요.');}
  };
  const saveTabOrder = order => {
    try {setTabOrder(order);setTabFailure('');}
    catch {setTabFailure('탭 설정을 저장하지 못했습니다. 이 기기의 저장 공간 접근을 확인해 주세요.');}
  };
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
    {discord && <DiscordLinkSection uid={uid} discord={discord} serverInfo={serverInfo} />}
    <section className="schedule-settings-timer">
      <h3>{copy.field('timerHeading')}</h3>
      <label>{copy.field('timerPopup')}<input type="checkbox" disabled={copy.editing} checked={timerPopupEnabled} onChange={e => {
        try { setTimerPopupEnabled(e.target.checked); setTimerFailure(''); }
        catch { setTimerFailure('타이머 설정을 저장하지 못했습니다. 이 기기의 저장 공간 접근을 확인해 주세요.'); }
      }} /></label>
      <label>{copy.field('timerCompact')}<input type="checkbox" disabled={copy.editing} checked={timerCompactEnabled}
        onChange={e => saveTimerPreference(() => setTimerCompactEnabled(e.target.checked))} /></label>
      <label>{copy.field('timerPopupPosition')}<select value={timerPopupPosition} disabled={copy.editing} onChange={e => {
        try {setTimerPopupPosition(e.target.value);setTimerFailure('');}
        catch {setTimerFailure('타이머 설정을 저장하지 못했습니다. 이 기기의 저장 공간 접근을 확인해 주세요.');}
      }}>
        <option value="left">{copy.value('timerPopupLeft')}</option>
        <option value="right">{copy.value('timerPopupRight')}</option>
      </select></label>
      <label>{labelWithHelp('studyGap','studyGapNote')}<input type="checkbox" disabled={copy.editing} checked={studyGapEnabled} onChange={e => {
        try { setStudyGapEnabled(e.target.checked); setTimerFailure(''); }
        catch { setTimerFailure('타이머 설정을 저장하지 못했습니다. 이 기기의 저장 공간 접근을 확인해 주세요.'); }
      }} /></label>
      {help.shown('studyGapNote') && <p>{copy.field('studyGapNote')}</p>}
      <label>{labelWithHelp('timerSwitch','timerSwitchNote')}<input type="checkbox" disabled={copy.editing} checked={timerSwitchEnabled} onChange={e => {
        try { setTimerSwitchEnabled(e.target.checked); setTimerFailure(''); }
        catch { setTimerFailure('타이머 설정을 저장하지 못했습니다. 이 기기의 저장 공간 접근을 확인해 주세요.'); }
      }} /></label>
      {help.shown('timerSwitchNote') && <p>{copy.field('timerSwitchNote')}</p>}
      <label>{labelWithHelp('flowRest','flowRestNote')}<input type="checkbox" disabled={copy.editing} checked={flowRestEnabled}
        onChange={e => saveTimerPreference(() => setFlowRestEnabled(e.target.checked))} /></label>
      {help.shown('flowRestNote') && <p>{copy.field('flowRestNote')}</p>}
      {timerFailure && <p role="alert">{timerFailure}</p>}
    </section>
    <section className="schedule-settings-timer">
      <div className="tab-order-heading">
        <h3 className="setting-help-label">{copy.field('tabsHeading')}{help.button('tabsNote', copy.value('tabsHeading'))}</h3>
        <button type="button" className="tab-order-reset" disabled={copy.editing || isDefaultOrder}
          onClick={() => saveTabOrder(null)}>{copy.field('tabOrderReset')}</button>
      </div>
      {help.shown('tabsNote') && <p>{copy.field('tabsNote')}</p>}
      <ol className="tab-order-list">
        {orderedTabs.map((tab,index) => {
          // 탭은 보기가 하나라도 보이면 표시된다. 모든 보기를 숨길 수 있어야 탭째 숨길 수 있다(탭 체크는 보기 전체를 켜고 끈다).
          const views = tabViews(tab);
          const hideableViews = views.filter(view => view.hideable);
          const hideable = hideableViews.length === views.length;
          const shown = views.some(view => !view.hideable || tabVisibility[view.id]);
          // 탭 안의 숨길 수 있는 하위 화면(예: 시간 관리의 통제, 메모의 메모·캘린더)
          const subViews = tab.views ? hideableViews : [];
          return <li key={tab.id} className={shown ? '' : 'tab-order-hidden'}>
            <input type="checkbox" aria-label={`${tab.label} 표시`} title={hideable ? '표시' : '항상 표시'}
              disabled={copy.editing || !hideable} checked={shown}
              onChange={event => hideableViews.forEach(view => saveTabVisible(view.id,event.target.checked))} />
            <span className="tab-order-name">{tab.label}</span>
            {subViews.map(view => <label key={view.id} className="tab-order-sub">
              <input type="checkbox" disabled={copy.editing} checked={tabVisibility[view.id]}
                onChange={event => saveTabVisible(view.id,event.target.checked)} />{view.label}
            </label>)}
            <button type="button" aria-label={`${tab.label} 앞으로`} title="앞으로" disabled={copy.editing || index === 0}
              onClick={() => saveTabOrder(moveTab(tabOrder,tab.id,-1,shownTabIds))}>↑</button>
            <button type="button" aria-label={`${tab.label} 뒤로`} title="뒤로" disabled={copy.editing || index === orderedTabs.length - 1}
              onClick={() => saveTabOrder(moveTab(tabOrder,tab.id,1,shownTabIds))}>↓</button>
          </li>;
        })}
      </ol>
      {tabFailure && <p role="alert">{tabFailure}</p>}
    </section>
    <form onSubmit={save}>
      <h3 className="schedule-settings-calendar-title setting-help-label">{copy.field('calendarHeading')}{help.button('range', copy.value('calendarHeading'))}</h3>
      {help.shown('range') && <p>{copy.field('rangeNote')}</p>}
      <div className="schedule-settings-hours">
        <label>{copy.field('start')} <select value={startHour} onChange={e => setStartHour(Number(e.target.value))} disabled={saving || copy.editing}>{options}</select></label>
        <label>{copy.field('end')} <select value={endHour} onChange={e => setEndHour(Number(e.target.value))} disabled={saving || copy.editing}>{options}</select></label>
      </div>
      {help.shown('range') && <p>{copy.field('rangeHistory')}</p>}
      {help.shown('range') && (copy.editing || copy.value('dayBoundary')) && <p>{copy.field('dayBoundary')}</p>}
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
