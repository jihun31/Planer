import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { controlColor } from '../../features/planner/controlColors.mjs';
import { clockLabel, timerSegments } from '../../features/planner/scheduleTime.mjs';
import { COLORS, CUSTOM_ID, fmtElapsed } from './plannerDisplay.mjs';
import { useTimerPopupPreference, useStudyGapPreference, useTimerPopupPosition } from '../../features/planner/timerPreferences';
import { prepareStudyGap } from '../../features/planner/studyGapService';
import StudyGapDialog from './StudyGapDialog';

let activeTimerOwner = null;

function TimerBlock({ uid, activities, allActivities, onSaveTimer, startActivityRef, control = false }) {
  const [popupEnabled] = useTimerPopupPreference(uid);
  const [popupPosition] = useTimerPopupPosition(uid);
  const [studyGapEnabled] = useStudyGapPreference(uid);
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
  const [popupWin, setPopupWin]       = useState(null);
  const [electronPopupOpen, setElectronPopupOpen] = useState(false);
  const handleStopRef = useRef(null);
  const stoppingRef   = useRef(false);
  const sessionRef = useRef(null);
  const pendingSave = useRef(null);
  const [saveError, setSaveError] = useState('');
  const [desktopError, setDesktopError] = useState('');
  const isCustom = actId === CUSTOM_ID;
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
  useEffect(() => () => {
    startRequest.current = null;
    if (activeTimerOwner === timerOwner.current) activeTimerOwner = null;
  }, []);

  const actMap    = useMemo(() => Object.fromEntries(allActivities.map(a => [a.id, a])), [allActivities]);
  useEffect(() => {
    if (!running && actId && actId !== CUSTOM_ID && !activities.some(a => a.id === actId)) setActId('');
  }, [activities, actId, running]);
  const curAct    = actMap[actId];
  const timerColor = isCustom ? (control ? controlColor(customGroup) : customColor) : (curAct?.color ?? '#6366f1');

  useEffect(() => {
    if (!running || startTs === null) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTs) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running, startTs]);

  // window.open 팝업 닫힘 감지
  useEffect(() => {
    if (!popupWin) return;
    const id = setInterval(() => {
      if (popupWin.closed) setPopupWin(null);
    }, 500);
    return () => clearInterval(id);
  }, [popupWin]);

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
      const data = { actName, color: selectedColor, startTs: ts, startLabel: clockLabel(ts), position: popupPosition };
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
    if (startRequest.current || running || saving || pendingSave.current || (sessionRef.current && !stoppingRef.current) || !selectedActId
      || (!selectedIsCustom && !activities.some(activity => activity.id === selectedActId))
      || (selectedIsCustom && (!customName.trim() || (control && !customGroup)))) return;
    if (activeTimerOwner && activeTimerOwner !== timerOwner.current) {
      alert('다른 탭의 타이머를 먼저 정지해 주세요.');return;
    }
    setActId(selectedActId);
    if (!selectedIsCustom) setCustomLearning(false);
    if (control || !studyGapEnabled) {beginTimer(Date.now(),selectedActId);return;}
    const ts = Date.now();
    const request = {startTs:ts,begin:() => beginTimer(ts,selectedActId),checking:false};
    startRequest.current = request;activeTimerOwner = timerOwner.current;
    setStarting(true);setDesktopError('');
    void checkGap(request);
  };

  const handlePopup = () => {
    // Electron 환경
    if (isElectron) {
      if (electronPopupOpen) {
        window.electronAPI.closeTimerPopup();
        setElectronPopupOpen(false);
      } else {
        const actName = isCustom ? customName : (curAct?.name ?? '');
        window.electronAPI.openTimerPopup({
          actName,
          color: timerColor,
          startTs,
          startLabel,
          position: popupPosition,
        });
        setElectronPopupOpen(true);
      }
      return;
    }

    // 브라우저 환경 (window.open)
    if (popupWin && !popupWin.closed) {
      popupWin.close();
      setPopupWin(null);
      return;
    }
    const sw = window.screen.availWidth;
    const sh = window.screen.availHeight;
    const sx = window.screen.availLeft || 0;
    const sy = window.screen.availTop || 0;
    const pw = 188, ph = 120;
    const popup = window.open(
      '',
      'timer-popup',
      `toolbar=no,menubar=no,location=no,status=no,scrollbars=no,resizable=no,` +
      `width=${pw},height=${ph},left=${sx + (popupPosition === 'left' ? 24 : sw - pw - 24)},top=${sy + sh - ph - 60}`
    );
    if (!popup) {
      alert('팝업이 차단됐습니다. 주소창 오른쪽의 팝업 허용 버튼을 클릭해주세요.');
      return;
    }
    document.querySelectorAll('style').forEach(s =>
      popup.document.head.appendChild(s.cloneNode(true))
    );
    popup.document.title = '⏱ 타이머';
    popup.document.body.style.cssText = 'margin:0;padding:0;';
    setPopupWin(popup);
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
    if (popupWin && !popupWin.closed) { popupWin.close(); setPopupWin(null); }

    const session = sessionRef.current;
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

  const startLabel = running && startTs !== null ? clockLabel(startTs) : null;

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
        disabled={running || starting}
      >
        <option value="">활동 선택</option>
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
        disabled={starting || saving || !!saveError || (!running && (!actId || (isCustom && (!customName.trim() || (control && !customGroup)))))}
        onClick={running ? handleStop : () => handleStart()}
      >
        {starting ? '시작 준비 중…' : saving ? '저장 중...' : running ? '■ 정지 & 기록' : '▶ 시작'}
      </button>

      {saveError && <p role="alert">{saveError}<button disabled={saving} onClick={savePending}>다시 저장</button></p>}
      {desktopError && <p role="alert">{desktopError}</p>}
      {starting && !gap && <div><p role="status">오늘의 이전 기록을 확인하는 중…</p>
        <button type="button" className="btn-signout" onClick={continueStart}>빈 시간 기록 건너뛰고 시작</button></div>}
      {gap && <StudyGapDialog key={`${gap.startTs}-${gap.error ? 'error' : 'ready'}`} uid={uid} gap={gap}
        onContinue={continueStart} onRetry={() => checkGap(startRequest.current)} />}

      {running && sessionPopupEnabled && !popupWin && !electronPopupOpen && createPortal(
        <div className={`float-timer${popupPosition === 'left' ? ' float-timer-left' : ''}`} style={{ '--ft-color': timerColor }}>
          <div className="ft-header">
            <span className="ft-dot" style={{ background: timerColor }} />
            <span className="ft-name">{isCustom ? customName : (curAct?.name ?? '')}</span>
            <button className="ft-pin" onClick={handlePopup} title="항상 위에 고정">📌</button>
          </div>
          <div className="ft-time" style={{ color: timerColor }}>{fmtElapsed(elapsed)}</div>
          {startLabel && <div className="ft-start" style={{ color: timerColor }}>{startLabel} 시작</div>}
          <button className="ft-stop" style={{ borderColor: timerColor, color: timerColor }}
            disabled={saving} onClick={handleStop}>
            {saving ? '저장 중...' : '■ 정지 & 기록'}
          </button>
        </div>,
        document.body
      )}

      {running && popupWin && !popupWin.closed && createPortal(
        <div className="popup-timer" style={{ '--ft-color': timerColor }}>
          <div className="ft-header">
            <span className="ft-dot" style={{ background: timerColor }} />
            <span className="ft-name">{isCustom ? customName : (curAct?.name ?? '')}</span>
            <button className="ft-pin" onClick={handlePopup} title="고정 해제">🔓</button>
          </div>
          <div className="ft-time" style={{ color: timerColor }}>{fmtElapsed(elapsed)}</div>
          {startLabel && <div className="ft-start" style={{ color: timerColor }}>{startLabel} 시작</div>}
          <button className="ft-stop" style={{ borderColor: timerColor, color: timerColor }}
            disabled={saving} onClick={handleStop}>
            {saving ? '저장 중...' : '■ 정지 & 기록'}
          </button>
        </div>,
        popupWin.document.body
      )}
    </div>
  );
}

export default TimerBlock;
