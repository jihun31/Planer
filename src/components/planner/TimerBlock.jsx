import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { controlColor } from '../../features/planner/controlColors.mjs';
import { clockLabel, timerSegments } from '../../features/planner/scheduleTime.mjs';
import { COLORS, CUSTOM_ID, fmtElapsed } from './plannerDisplay.mjs';
import { useTimerPopupPreference, useTimerCompactPreference, useStudyGapPreference, useTimerPopupPosition, useTimerSwitchPreference,
  useFlowRestPreference } from '../../features/planner/timerPreferences';
import { flowRestMinutes } from '../../features/planner/flowtime.mjs';
import { prepareStudyGap } from '../../features/planner/studyGapService';
import StudyGapDialog from './StudyGapDialog';
import TimerSwitchDialog from './TimerSwitchDialog';
import { restTimer } from './restTimer';

let activeTimerOwner = null;

function TimerBlock({ uid, activities, allActivities, onSaveTimer, startActivityRef, control = false,
  restAvailable, returnActivities, onRestReturn, restTarget, switchGroups, onSwitch, switchTarget, onSwitchPrompt, onFlowRest, flowRestTarget }) {
  const [popupEnabled] = useTimerPopupPreference(uid);
  const [compactEnabled] = useTimerCompactPreference(uid);
  const [popupPosition] = useTimerPopupPosition(uid);
  const [studyGapEnabled] = useStudyGapPreference(uid);
  const [switchEnabled] = useTimerSwitchPreference(uid);
  const [flowRestEnabled] = useFlowRestPreference(uid);
  // 기록 타이머를 정지하면 저장한 뒤 일한 시간에 맞춘 휴식을 통제 화면에서 바로 시작한다.
  const flowRestApplied = useRef(null);
  // 정지한 기록이 저장되면 다음 활동을 고르는 창을 띄운다.
  const [switchPrompt, setSwitchPrompt] = useState(null);
  const promptAfterSave = useRef(null);
  const switchApplied = useRef(null);
  const [starting,setStarting] = useState(false);
  const [gap,setGap] = useState(null);
  const startRequest = useRef(null);
  const [sessionPopupEnabled, setSessionPopupEnabled] = useState(true);
  const timerOwner = useRef(Symbol('timer'));
  const [actId, setActId]             = useState('');
  const [customName, setCustomName]   = useState('');
  const [customColor, setCustomColor] = useState(COLORS[0]);
  const [customGroup, setCustomGroup] = useState('');
  const [customLearning, setCustomLearning] = useState(false);
  const [running, setRunning]         = useState(false);
  const [startTs, setStartTs]         = useState(null);
  const [elapsed, setElapsed]         = useState(0);
  const [saving, setSaving]           = useState(false);
  const [electronPopupOpen, setElectronPopupOpen] = useState(false);
  const handleStopRef = useRef(null);
  const stoppingRef   = useRef(false);
  const sessionRef = useRef(null);
  const pendingSave = useRef(null);
  const [saveError, setSaveError] = useState('');
  const [desktopError, setDesktopError] = useState('');
  const isCustom = actId === CUSTOM_ID;
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
  const rest = restTimer.useTimer({
    uid, enabled: control, popupPosition, popupCompact: compactEnabled, returnActivities, onSaveTimer, onReturn: onRestReturn,
    lock: () => { activeTimerOwner = timerOwner.current; },
    unlock: () => { if (activeTimerOwner === timerOwner.current) activeTimerOwner = null; },
  });
  const defaultRest = restAvailable && !restTimer.findRest(activities);
  useEffect(() => () => {
    startRequest.current = null;
    if (activeTimerOwner === timerOwner.current) activeTimerOwner = null;
  }, []);

  const actMap    = useMemo(() => Object.fromEntries(allActivities.map(a => [a.id, a])), [allActivities]);
  useEffect(() => {
    if (!running && actId && actId !== CUSTOM_ID && !(defaultRest && actId === restTimer.optionId) &&
      !activities.some(a => a.id === actId)) setActId('');
  }, [activities, actId, running, defaultRest]);
  const curAct    = actMap[actId];
  const timerColor = isCustom ? (control ? controlColor(customGroup) : customColor) : (curAct?.color ?? '#6366f1');

  useEffect(() => {
    if (!running || startTs === null) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTs) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running, startTs]);

  // Electron: 팝업 창에서 정지 명령을 받으면 handleStop 실행
  useEffect(() => {
    if (!isElectron) return;
    const cb = () => {
      setElectronPopupOpen(false);
      handleStopRef.current?.();
    };
    return window.electronAPI.onTimerStopped(cb);
  }, [isElectron]);

  const beginTimer = (ts = Date.now(), selectedActId = actId) => {
    const selectedIsCustom = selectedActId === CUSTOM_ID;
    const selectedActivity = actMap[selectedActId];
    const selectedColor = selectedIsCustom ? timerColor : (selectedActivity?.color ?? '#6366f1');
    if (running || saving || pendingSave.current || (sessionRef.current && !stoppingRef.current) || !selectedActId
      || (selectedIsCustom && (!customName.trim() || (control && !customGroup)))) return;
    if (activeTimerOwner && activeTimerOwner !== timerOwner.current) {
      alert('다른 탭의 타이머를 먼저 정지해 주세요.');
      return;
    }
    activeTimerOwner = timerOwner.current;
    stoppingRef.current = false;
    setDesktopError('');
    sessionRef.current = {
      startTs: ts,
      metadata: selectedIsCustom ? { activityId: null, customName: customName.trim(), customColor: selectedColor, ...(control ? { group: customGroup } : { learningIncluded: customLearning }) }
        : { activityId: selectedActId, activityName: selectedActivity?.name || '', activityColor: selectedColor, ...(control ? { group: selectedActivity?.group } : {}) },
    };
    setStartTs(ts);
    setElapsed(Math.max(0,Math.floor((Date.now() - ts) / 1000)));
    setSessionPopupEnabled(popupEnabled);
    setRunning(true);

    if (popupEnabled && isElectron) {
      const actName = selectedIsCustom ? customName : (selectedActivity?.name ?? '');
      const data = { actName, color: selectedColor, startTs: ts, startLabel: clockLabel(ts), position: popupPosition, compact: compactEnabled };
      const api = window.electronAPI;
      if (typeof api.startTimerPopup === 'function') {
        Promise.resolve().then(() => api.startTimerPopup(data)).then(result => {
          if (!result?.ok) {
            setDesktopError('별도 타이머 창을 열지 못했습니다. 앱을 다시 시작해 주세요.');
            return;
          }
          if (stoppingRef.current || sessionRef.current?.startTs !== ts) {
            api.closeTimerPopup();
            return;
          }
          setElectronPopupOpen(true);
        }).catch(() => setDesktopError('별도 타이머 창을 열지 못했습니다. 앱을 다시 시작해 주세요.'));
      } else {
        setDesktopError('데스크톱 연결이 끊겼습니다. 앱을 다시 시작해 주세요.');
      }
    } else if (popupEnabled && typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)) {
      setDesktopError('데스크톱 연결이 끊겼습니다. 앱을 다시 시작해 주세요.');
    }
  };

  const cancelStart = () => {
    startRequest.current = null;setGap(null);setStarting(false);
    if (activeTimerOwner === timerOwner.current) activeTimerOwner = null;
  };
  const continueStart = () => {
    const request = startRequest.current;
    if (!request) return;
    startRequest.current = null;setGap(null);setStarting(false);
    request.begin();
  };
  const checkGap = async request => {
    if (!request || request.checking) return;
    request.checking = true;setGap(null);
    try {
      const result = await prepareStudyGap(uid,request.startTs);
      if (startRequest.current !== request) return;
      if (result) setGap(result);
      else continueStart();
    } catch {
      if (startRequest.current === request) setGap({error:true,startTs:request.startTs});
    } finally {request.checking = false;}
  };
  const handleStart = (selectedActId = actId) => {
    const selectedIsCustom = selectedActId === CUSTOM_ID;
    const isRest = control && ((defaultRest && selectedActId === restTimer.optionId) || restTimer.isRestName(actMap[selectedActId]?.name));
    if (rest.active && isRest) { rest.open(); return; }
    if (rest.busy || startRequest.current || running || saving || pendingSave.current || (sessionRef.current && !stoppingRef.current) || !selectedActId
      || (!selectedIsCustom && !isRest && !activities.some(activity => activity.id === selectedActId))
      || (selectedIsCustom && (!customName.trim() || (control && !customGroup)))) return;
    if (activeTimerOwner && activeTimerOwner !== timerOwner.current) {
      alert('다른 탭의 타이머를 먼저 정지해 주세요.');return;
    }
    setActId(selectedActId);
    if (!selectedIsCustom) setCustomLearning(false);
    if (isRest) { rest.open(); return; }
    if (control || !studyGapEnabled) {beginTimer(Date.now(),selectedActId);return;}
    const ts = Date.now();
    const request = {startTs:ts,begin:() => beginTimer(ts,selectedActId),checking:false};
    startRequest.current = request;activeTimerOwner = timerOwner.current;
    setStarting(true);setDesktopError('');
    void checkGap(request);
  };

  // 앱 안의 떠 있는 타이머를 별도 '항상 위' 창으로 옮기거나 다시 닫는다.
  const handlePopup = () => {
    if (!isElectron) return;
    if (electronPopupOpen) {
      window.electronAPI.closeTimerPopup();
      setElectronPopupOpen(false);
      return;
    }
    const actName = isCustom ? customName : (curAct?.name ?? '');
    window.electronAPI.openTimerPopup({ actName, color: timerColor, startTs, startLabel, position: popupPosition, compact: compactEnabled });
    setElectronPopupOpen(true);
  };

  const handleStop = async () => {
    if (!running || startTs === null) return;
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    if (activeTimerOwner === timerOwner.current) activeTimerOwner = null;

    const endTs = Date.now();
    setRunning(false);
    if (isElectron && electronPopupOpen) {
      window.electronAPI.closeTimerPopup();
      setElectronPopupOpen(false);
    }

    const session = sessionRef.current;
    // 정지 후 창 하나에서 휴식(기록 타이머만, 작업 종료 시 휴식 연결)·다음 활동 배지·종료 중 하나를 고른다.
    const restMinutes = !control && flowRestEnabled && onFlowRest ? flowRestMinutes(endTs - session.startTs) : null;
    const showSwitch = switchEnabled && !!onSwitch;
    promptAfterSave.current = restMinutes || showSwitch ? {
      name: session.metadata.activityName || session.metadata.customName || '',
      color: session.metadata.activityColor || session.metadata.customColor,
      seconds: Math.max(0, Math.floor((endTs - session.startTs) / 1000)),
      showSwitch,
      rest: restMinutes ? { minutes: restMinutes, returnActivityId: session.metadata.activityId ?? undefined } : null,
    } : null;
    pendingSave.current = { startTs: session.startTs, segments: timerSegments(session.startTs, endTs), metadata: session.metadata };
    await savePending();
  };

  const savePending = async () => {
    if (!pendingSave.current || saving) return;
    setSaving(true); setSaveError('');
    try {
      await onSaveTimer(pendingSave.current);
      if (pendingSave.current.metadata.activityId === null) setCustomLearning(false);
      pendingSave.current = null;
      // 다른 탭에서 정지했으면 이 타이머의 탭으로 옮긴다. 숨은 탭 안에서 모달 창이 열리면 보이지 않은 채 앱 전체를 막는다.
      if (promptAfterSave.current) { setSwitchPrompt(promptAfterSave.current); promptAfterSave.current = null; onSwitchPrompt?.(); }
    } catch {
      setSaveError('기록을 저장하지 못했습니다. 연결을 확인하고 다시 저장해 주세요.');
    } finally { setSaving(false); }
  };

  handleStopRef.current = handleStop;
  useEffect(() => {
    if (!startActivityRef) return;
    startActivityRef.current = handleStart;
    return () => {
      if (startActivityRef.current === handleStart) startActivityRef.current = null;
    };
  });

  // 다음 활동 창에서 고른 활동을 이 타이머(기록 또는 통제)에서 시작한다. 활동 목록을 불러올 때까지 기다린다.
  useEffect(() => {
    if (!switchTarget || switchApplied.current === switchTarget || saving || pendingSave.current) return;
    const builtinRest = switchTarget.activityId === restTimer.optionId;
    const ownRest = builtinRest ? restTimer.findRest(activities) : null;
    if (builtinRest ? !(ownRest || defaultRest) : !activities.some(activity => activity.id === switchTarget.activityId)) return;
    switchApplied.current = switchTarget;
    handleStart(ownRest ? ownRest.id : switchTarget.activityId);
  });

  // 기록 타이머에서 넘어온 휴식 요청을 받아 바로 시작한다. 다른 타이머가 돌고 있으면 건너뛴다.
  useEffect(() => {
    if (!control || !flowRestTarget || flowRestApplied.current === flowRestTarget) return;
    flowRestApplied.current = flowRestTarget;
    if (running || starting || saving || pendingSave.current || rest.busy
      || (activeTimerOwner && activeTimerOwner !== timerOwner.current)) return;
    rest.startNow(flowRestTarget);
  });

  const startLabel = running && startTs !== null ? clockLabel(startTs) : null;
  restTimer.useReturnTimer(restTarget, activities, activityId => {
    setActId(activityId);
    setCustomLearning(false);
    beginTimer(Date.now(), activityId);
  });

  return (
    <div
      className={`timer-block${running ? ' timer-running' : ''}`}
      style={running ? { '--timer-color': timerColor } : {}}
    >
      <div className="timer-header">
        <span className="timer-title">⏱ 타이머</span>
        {running && <span className="timer-pulse" style={{ background: timerColor }} />}
      </div>

      <select
        className="form-select-sm"
        style={{ width: '100%', ...(control && curAct ? { color: timerColor, fontWeight: 700 } : {}) }}
        value={actId}
        onChange={(e) => { setActId(e.target.value); if (e.target.value !== CUSTOM_ID) setCustomLearning(false); }}
        disabled={running || starting || rest.busy}
      >
        <option value="">활동 선택</option>
        {defaultRest && <option value={restTimer.optionId}>{restTimer.restName}</option>}
        {activities.map(a => <option key={a.id} value={a.id} style={control ? { color: a.color } : undefined}>{a.name}</option>)}
        <option value={CUSTOM_ID}>✏️ 직접 입력</option>
      </select>

      {isCustom && !running && !starting && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <input
            autoFocus
            className="form-input"
            style={{ width: '100%', padding: '7px 9px', fontSize: '0.83rem' }}
            placeholder="활동명"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
          />
          {control && <select className="form-select-sm" value={customGroup} onChange={e => setCustomGroup(e.target.value)} required>
            <option value="">그룹 선택</option><option value="controlled">통제</option><option value="foolish">어리석음</option>
          </select>}
          {!control && <div className="color-palette">
            {COLORS.map(c => (
              <button
                key={c} type="button"
                className={`color-dot ${c === customColor ? 'color-selected' : ''}`}
                style={{ background: c, width: '16px', height: '16px' }}
                onClick={() => setCustomColor(c)}
              />
            ))}
          </div>}
          {!control && <label className="learning-custom-checkbox"><input type="checkbox" checked={customLearning} onChange={e => setCustomLearning(e.target.checked)} /> 학습 기록에 포함</label>}
        </div>
      )}

      <div className="timer-display" style={running ? { color: timerColor } : {}}>
        {fmtElapsed(elapsed)}
      </div>

      {startLabel && (
        <div className="timer-start-label" style={{ color: timerColor }}>
          {startLabel} 시작
        </div>
      )}

      <button
        type="button"
        className={`timer-btn${running ? ' timer-btn-stop' : ' timer-btn-start'}`}
        style={
          running
            ? { borderColor: timerColor, color: timerColor }
            : actId
              ? { background: timerColor, borderColor: timerColor, color: '#fff' }
              : {}
        }
        disabled={!rest.active && (rest.busy || starting || saving || !!saveError || (!running && (!actId || (isCustom && (!customName.trim() || (control && !customGroup))))))}
        onClick={rest.active ? rest.open : running ? handleStop : () => handleStart()}
      >
        {rest.active ? '휴식 타이머 보기' : starting ? '시작 준비 중…' : saving ? '저장 중...' : running ? '■ 정지 & 기록' : '▶ 시작'}
      </button>

      {saveError && <p role="alert">{saveError}<button disabled={saving} onClick={savePending}>다시 저장</button></p>}
      {desktopError && <p role="alert">{desktopError}</p>}
      {starting && !gap && <div><p role="status">오늘의 이전 기록을 확인하는 중…</p>
        <button type="button" className="btn-signout" onClick={continueStart}>빈 시간 기록 건너뛰고 시작</button></div>}
      {gap && <StudyGapDialog key={`${gap.startTs}-${gap.error ? 'error' : 'ready'}`} uid={uid} gap={gap}
        onContinue={continueStart} onRetry={() => checkGap(startRequest.current)} onCancel={cancelStart} />}

      {running && sessionPopupEnabled && !electronPopupOpen && createPortal(
        <div className={`float-timer${popupPosition === 'left' ? ' float-timer-left' : ''}${compactEnabled ? ' float-timer-compact' : ''}`} style={{ '--ft-color': timerColor }}>
          <div className="ft-header">
            <span className="ft-dot" style={{ background: timerColor }} />
            <span className="ft-name">{isCustom ? customName : (curAct?.name ?? '')}</span>
            {compactEnabled && <span className="ft-time" style={{ color: timerColor }}>{fmtElapsed(elapsed)}</span>}
            {isElectron && <button className="ft-pin" onClick={handlePopup} title="항상 위에 고정">📌</button>}
          </div>
          {!compactEnabled && <div className="ft-time" style={{ color: timerColor }}>{fmtElapsed(elapsed)}</div>}
          {!compactEnabled && startLabel && <div className="ft-start" style={{ color: timerColor }}>{startLabel} 시작</div>}
          <button className="ft-stop" style={{ borderColor: timerColor, color: timerColor }}
            disabled={saving} onClick={handleStop}>
            {saving ? '저장 중...' : compactEnabled ? '■ 정지' : '■ 정지 & 기록'}
          </button>
        </div>,
        document.body
      )}

      {switchPrompt && <TimerSwitchDialog finished={switchPrompt} groups={switchPrompt.showSwitch ? switchGroups ?? [] : []}
        rest={switchPrompt.rest} onClose={() => setSwitchPrompt(null)}
        onRest={request => { setSwitchPrompt(null); onFlowRest?.(request); }}
        onPick={(view, activityId) => { setSwitchPrompt(null); onSwitch(view, activityId); }} />}

      {rest.panel}
    </div>
  );
}

export default TimerBlock;
