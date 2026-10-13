import { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePlanner } from "../../features/planner/usePlanner";
import { useControl } from "../../features/planner/useControl";
import { controlColor } from "../../features/planner/controlColors.mjs";
import { oppositeDisplayFromHistory } from '../../features/planner/oppositeDisplay.mjs';
import "../../styles/planner.css";
import { blockActivity, summarizeBlocks } from "../../features/planner/activityHistory.mjs";

import { plannerDate, rangeForDate, visibleHours, blockMinutes, clockLabel, timerSegments } from '../../features/planner/scheduleTime.mjs';

const COLORS = [
  '#6366f1', '#3b82f6', '#22c55e', '#eab308', '#f97316',
  '#ef4444', '#ec4899', '#14b8a6', '#8b5cf6', '#6b7280',
];

const MINUTES_ARR = Array.from({ length: 60 }, (_, i) => i);
const CUSTOM_ID   = '__custom__';
let activeTimerOwner = null;


const minToTime = (min) => {
  const total = 8 * 60 + min;
  const h = ((Math.floor(total / 60) % 24) + 24) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const fmtHour = (h) => `${String(h >= 24 ? h - 24 : h).padStart(2, '0')}:00`;

const effectiveNow = () => {
  const d = new Date();
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  return d;
};

const nowDateStr = plannerDate;

const getBlockMins = blockMinutes;


const fmtMins = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
};

const fmtElapsed = (s) => {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

function TimerBlock({ activities, allActivities, onSaveTimer, control = false }) {
  const timerOwner = useRef(Symbol('timer'));
  const [actId, setActId]             = useState('');
  const [customName, setCustomName]   = useState('');
  const [customColor, setCustomColor] = useState(COLORS[0]);
  const [customGroup, setCustomGroup] = useState('');
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
  const isCustom = actId === CUSTOM_ID;
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
  useEffect(() => () => {
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

  const handleStart = () => {
    if (running || saving || pendingSave.current || !actId || (isCustom && (!customName.trim() || (control && !customGroup)))) return;
    if (activeTimerOwner && activeTimerOwner !== timerOwner.current) {
      alert('다른 탭의 타이머를 먼저 정지해 주세요.');
      return;
    }
    activeTimerOwner = timerOwner.current;
    stoppingRef.current = false;
    const ts = Date.now();
    sessionRef.current = {
      startTs: ts,
      metadata: isCustom ? { activityId: null, customName: customName.trim(), customColor: timerColor, ...(control ? { group: customGroup } : {}) }
        : { activityId: actId, activityName: curAct?.name || '', activityColor: timerColor, ...(control ? { group: curAct?.group } : {}) },
    };
    setStartTs(ts);
    setElapsed(0);
    setRunning(true);

    if (isElectron) {
      const actName = isCustom ? customName : (curAct?.name ?? '');
      window.electronAPI.openTimerPopup({ actName, color: timerColor, startTs: ts, startLabel: clockLabel(ts) });
      setElectronPopupOpen(true);
      window.electronAPI.minimizeMain();
    }
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
    const pw = 188, ph = 120;
    const popup = window.open(
      '',
      'timer-popup',
      `toolbar=no,menubar=no,location=no,status=no,scrollbars=no,resizable=no,` +
      `width=${pw},height=${ph},left=${sw - pw - 24},top=${sh - ph - 60}`
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
      pendingSave.current = null;
    } catch {
      setSaveError('기록을 저장하지 못했습니다. 연결을 확인하고 다시 저장해 주세요.');
    } finally { setSaving(false); }
  };

  handleStopRef.current = handleStop;

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
        onChange={(e) => setActId(e.target.value)}
        disabled={running}
      >
        <option value="">활동 선택</option>
        {activities.map(a => <option key={a.id} value={a.id} style={control ? { color: a.color } : undefined}>{a.name}</option>)}
        <option value={CUSTOM_ID}>✏️ 직접 입력</option>
      </select>

      {isCustom && !running && (
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
        disabled={saving || !!saveError || (!running && (!actId || (isCustom && (!customName.trim() || (control && !customGroup)))))}
        onClick={running ? handleStop : handleStart}
      >
        {saving ? '저장 중...' : running ? '■ 정지 & 기록' : '▶ 시작'}
      </button>

      {saveError && <p role="alert">{saveError}<button disabled={saving} onClick={savePending}>다시 저장</button></p>}

      {running && !popupWin && !electronPopupOpen && createPortal(
        <div className="float-timer" style={{ '--ft-color': timerColor }}>
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

function ActivityManager({ activities, onAdd, onDelete, onUpdateOrder, onUpdateGroup, control = false }) {
  const [name, setName]             = useState('');
  const [color, setColor]           = useState(COLORS[0]);
  const [group, setGroup]           = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [changingGroups, setChangingGroups] = useState(false);
  const [groupBusyId, setGroupBusyId] = useState(null);
  const [deleteBusyId, setDeleteBusyId] = useState(null);
  const [localIds, setLocalIds]     = useState([]);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!reordering) setLocalIds(activities.map(a => a.id));
  }, [activities, reordering]);

  const displayActivities = reordering
    ? localIds.map(id => activities.find(a => a.id === id)).filter(Boolean)
    : activities;

  const move = (idx, dir) => {
    const next = [...localIds];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    if (control && displayActivities[idx]?.group !== displayActivities[swap]?.group) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setLocalIds(next);
  };

  const handleDone = async () => {
    setReordering(false);
    try { await onUpdateOrder(localIds); }
    catch { setActionError('활동 순서를 저장하지 못했습니다. 다시 시도해 주세요.'); }
  };

  const handleGroupChange = async (id, nextGroup) => {
    if (groupBusyId) return;
    setActionError('');
    setGroupBusyId(id);
    try { await onUpdateGroup(id, nextGroup); }
    catch { setActionError('그룹을 변경하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setGroupBusyId(null); }
  };

  const handleDelete = async id => {
    if (deleteBusyId) return;
    setActionError('');
    setDeleteBusyId(id);
    try {
      await onDelete(id);
      setLocalIds(ids => ids.filter(value => value !== id));
    } catch { setActionError('활동을 삭제하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setDeleteBusyId(null); }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!name.trim() || (control && !group)) return;
    setSubmitting(true);
    setActionError('');
    try {
      await onAdd({ name: name.trim(), color: control ? controlColor(group) : color, ...(control ? { group } : {}) });
      setName('');
    } catch { setActionError('활동을 추가하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="act-manager">
      <div className="act-chips-row">
        <div className="act-chips">
          {activities.length === 0 ? (
            <span className="act-empty">활동을 추가하면 표에서 기록할 수 있어요</span>
          ) : (
            displayActivities.map((a, idx) => (
              <span key={a.id} className="act-chip"
                style={{ background: a.color + '20', borderColor: a.color + '80', color: a.color }}
              >
                <span className="act-chip-dot" style={{ background: a.color }} />
                {a.name}
                {changingGroups && <button type="button" className="act-chip-change"
                  title={`${a.name}: ${a.group === 'foolish' ? '어리석음' : '통제'} → ${a.group === 'foolish' ? '통제' : '어리석음'}`}
                  aria-label={`${a.name} 그룹 변경`} disabled={groupBusyId === a.id}
                  onClick={() => handleGroupChange(a.id, a.group === 'foolish' ? 'controlled' : 'foolish')}>⇄</button>}
                {reordering ? (
                  <>
                    <button type="button" className="act-chip-move" onClick={() => move(idx, -1)}
                      disabled={idx === 0 || (control && displayActivities[idx - 1]?.group !== a.group)}>‹</button>
                    <button type="button" className="act-chip-move" onClick={() => move(idx, 1)}
                      disabled={idx === displayActivities.length - 1 || (control && displayActivities[idx + 1]?.group !== a.group)}>›</button>
                    <button type="button" className="act-chip-del act-chip-del-visible" title="활동 목록에서 삭제 (과거 기록은 유지)"
                      disabled={deleteBusyId === a.id} onClick={() => handleDelete(a.id)}>✕</button>
                  </>
                ) : null}
              </span>
            ))
          )}
        </div>
        <div className="act-manager-actions">
          {activities.length > 0 && (
            <button type="button"
              className={`act-reorder-btn${reordering ? ' act-reorder-active' : ''}`}
              onClick={reordering ? handleDone : () => setReordering(true)} disabled={changingGroups || !!deleteBusyId}
              title={reordering ? '순서 변경 완료' : '활동 순서 수정'}
            >
              {reordering ? '완료' : '✎'}
            </button>
          )}
          {control && activities.length > 0 && <button type="button"
            className={`act-reorder-btn${changingGroups ? ' act-reorder-active' : ''}`}
            onClick={() => setChangingGroups(value => !value)} disabled={reordering || !!groupBusyId}
            title={changingGroups ? '그룹 변경 완료' : '활동 그룹 변경'}>
            {changingGroups ? '완료' : '그룹 변경'}
          </button>}
        </div>
      </div>
      <form className="act-add-form" onSubmit={handleAdd}>
        {control && <select className="form-select-sm" value={group} onChange={e => setGroup(e.target.value)} required>
          <option value="">그룹 선택</option><option value="controlled">통제</option><option value="foolish">어리석음</option>
        </select>}
        {!control && <div className="color-palette">
          {COLORS.map(c => (
            <button key={c} type="button"
              className={`color-dot ${c === color ? 'color-selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>}
        <input
          className="form-input"
          style={{ flex: 1, minWidth: '120px' }}
          placeholder="활동 이름 (예: 독서, 기타, 운동, 휴식)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="btn btn-login" type="submit" disabled={submitting}>
          {submitting ? '...' : '+ 추가'}
        </button>
      </form>
      {actionError && <p role="alert" className="act-error">{actionError}</p>}
    </div>
  );
}

function PlannerCalendar({ year, month, selectedDate, blocks, oppositeBlocks, oppositeActivities, oppositeMode, onSelectDate, onMonthChange, control = false }) {
  const DAY_LABELS  = ['일', '월', '화', '수', '목', '금', '토'];
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today       = nowDateStr();

  const datesWithBlocks = useMemo(() => {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    return new Set(blocks.filter(b => b.date?.startsWith(prefix)).map(b => b.date));
  }, [blocks, year, month]);
  const oppositeByDate = useMemo(() => {
    const result = new Map();
    for (const block of oppositeBlocks) if (!result.has(block.date)) result.set(block.date, block);
    return result;
  }, [oppositeBlocks]);
  const oppositeActMap = useMemo(() => Object.fromEntries(oppositeActivities.map(a => [a.id, a])), [oppositeActivities]);

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let dd = 1; dd <= daysInMonth; dd++) cells.push(dd);

  return (
    <div className="planner-cal">
      <div className="cal-header">
        <button className="cal-nav" onClick={() => onMonthChange(-1)}>‹</button>
        <span className="cal-title">{year}년 {month + 1}월</span>
        <button className="cal-nav" onClick={() => onMonthChange(1)}>›</button>
      </div>
      <div className="cal-grid">
        {DAY_LABELS.map(dl => <div key={dl} className="cal-day-label">{dl}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={`_${i}`} />;
          const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const oppositeBlock = oppositeByDate.get(ds);
          const showOpposite = oppositeBlock && oppositeMode !== 'hidden';
          const oppositeColor = oppositeBlock && controlColor(
            oppositeBlock.group || oppositeActMap[oppositeBlock.activityId]?.group);
          return (
            <button key={day}
              className={`cal-day ${ds === selectedDate ? 'cal-sel' : ''} ${ds === today ? 'cal-today' : ''}`}
              onClick={() => onSelectDate(ds)}
            >
              {day}
              {(datesWithBlocks.has(ds) || showOpposite) && <span className="cal-dots">
                {(control || datesWithBlocks.has(ds)) && <span className="cal-dot" />}
                {!control && showOpposite && <span className={`cal-dot cal-dot-opposite-${oppositeMode}`}
                  style={{ background: oppositeMode === 'blind' ? '#aeb7c5' : oppositeColor }} />}
              </span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthlyStats({ year, month, blocks, activities, control = false }) {
  const actMap      = useMemo(() => Object.fromEntries(activities.map(a => [a.id, a])), [activities]);
  const prefix      = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthBlocks = blocks.filter(b => b.date?.startsWith(prefix));

  const stats = useMemo(() => summarizeBlocks(monthBlocks, actMap), [monthBlocks, actMap]);
  const grouped = useMemo(() => {
    const groups = { controlled: { key: 'controlled', name: '통제', mins: 0, items: [] }, foolish: { key: 'foolish', name: '어리석음', mins: 0, items: [] } };
    for (const block of monthBlocks) {
      const group = block.group || actMap[block.activityId]?.group || 'controlled';
      const bucket = groups[group] || groups.controlled;
      const mins = getBlockMins(block).endMin - getBlockMins(block).startMin;
      if (Number.isFinite(mins) && mins > 0) bucket.mins += mins;
    }
    for (const [key, bucket] of Object.entries(groups))
      bucket.items = summarizeBlocks(monthBlocks.filter(block =>
        (block.group || actMap[block.activityId]?.group || 'controlled') === key), actMap);
    return Object.values(groups);
  }, [monthBlocks, actMap]);

  const maxH = stats.length ? stats[0].hours : 1;

  return (
    <div className="monthly-stats">
      <p className="stats-title">📊 {month + 1}월 통계</p>
      {stats.length === 0 ? (
        <p className="stats-empty">이번 달 기록이 없습니다.</p>
      ) : (
        <div className="stats-list">
          {(control ? grouped.flatMap(group => [
            <div className="stats-group" key={`group-${group.name}`} style={{ color: controlColor(group.key) }}>
              <strong>{group.name}</strong><span>{fmtMins(group.mins)}</span>
            </div>,
            ...group.items.map(s => (
              <div key={`${group.name}-${s.key}`} className="stats-row stats-activity-row">
                <span className="stats-name" style={{ color: s.color }} title={s.name}>{s.name}</span>
                <div className="stats-bar-bg"><div className="stats-bar-fill" style={{ width: `${(s.hours / maxH) * 100}%`, background: s.color }} /></div>
                <span className="stats-hr">{s.hours.toFixed(1)}h</span>
              </div>
            )),
          ]) : stats.map(s => (
            <div key={s.key} className="stats-row">
              <span className="stats-name" style={{ color: s.color }} title={s.name}>{s.name}</span>
              <div className="stats-bar-bg">
                <div className="stats-bar-fill"
                  style={{ width: `${(s.hours / maxH) * 100}%`, background: s.color }} />
              </div>
              <span className="stats-hr">{s.hours.toFixed(1)}h</span>
            </div>
          )))}
        </div>
      )}
    </div>
  );
}

function DailySchedule({ date, range, blocks, oppositeBlocks, oppositeActivities, oppositeMode, activities, allActivities, onAddBlock, onDeleteBlock, control = false }) {
  const [pending, setPending]         = useState(null);
  const [hovered, setHovered]         = useState(null);
  const [selMin, setSelMin]           = useState(null);
  const [selMax, setSelMax]           = useState(null);
  const [actId, setActId]             = useState('');
  const [customName, setCustomName]   = useState('');
  const [customColor, setCustomColor] = useState(COLORS[0]);
  const [customGroup, setCustomGroup] = useState('');
  const [saveError, setSaveError] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const isCustom = actId === CUSTOM_ID;
  useEffect(() => {
    if (actId && actId !== CUSTOM_ID && !activities.some(a => a.id === actId)) setActId('');
  }, [activities, actId]);

  const actMap = useMemo(
    () => Object.fromEntries(allActivities.map(a => [a.id, a])),
    [allActivities]
  );
  const oppositeActMap = useMemo(
    () => Object.fromEntries(oppositeActivities.map(a => [a.id, a])),
    [oppositeActivities]
  );

  const dayBlocks = useMemo(
    () => blocks.filter(b => b.date === date && (b.startMin != null || b.startSlot != null || b.startHour != null)),
    [blocks, date]
  );
  const dayOppositeBlocks = useMemo(() => oppositeBlocks.filter(b => b.date === date), [oppositeBlocks, date]);

  const hours = useMemo(() => visibleHours(range, oppositeMode === 'hidden'
    ? dayBlocks : [...dayBlocks, ...dayOppositeBlocks]), [range, dayBlocks, dayOppositeBlocks, oppositeMode]);
  const daySummary = useMemo(() => summarizeBlocks(dayBlocks, actMap), [dayBlocks, actMap]);
  const controlDaySummary = useMemo(() => {
    if (!control) return [];
    return [['controlled', '통제'], ['foolish', '어리석음']].map(([key, name]) => {
      const items = summarizeBlocks(dayBlocks.filter(block =>
        (block.group || actMap[block.activityId]?.group || 'controlled') === key), actMap);
      return { key, name, items, mins: items.reduce((sum, item) => sum + item.mins, 0) };
    });
  }, [control, dayBlocks, actMap]);

  // 반대편 기록은 공부 기록보다 우선하지 않으며, 시간 관리 탭에서는 선택을 막지 않는다.
  const oppositeMinMap = useMemo(() => {
    const m = {};
    for (const blk of dayOppositeBlocks) {
      const { startMin, endMin } = getBlockMins(blk);
      const opposite = { ...blk, _opposite: true };
      for (let i = startMin; i < endMin; i++) m[i] = opposite;
    }
    return m;
  }, [dayOppositeBlocks]);
  const ownMinMap = useMemo(() => {
    const m = {};
    for (const blk of dayBlocks) {
      const { startMin, endMin } = getBlockMins(blk);
      for (let i = startMin; i < endMin; i++) m[i] = blk;
    }
    return m;
  }, [dayBlocks]);
  const minMap = useMemo(() => ({ ...oppositeMinMap, ...ownMinMap }), [oppositeMinMap, ownMinMap]);
  const blockedMinMap = control ? minMap : ownMinMap;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setPending(null); setSelMin(null); setSelMax(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleCellClick = (min) => {
    if (blockedMinMap[min]) {
      if (oppositeMode === 'hidden' && oppositeMinMap[min] && control)
        setSaveError('공부 시간과 겹쳐 이 구간에는 기록할 수 없습니다.');
      return;
    }
    setSaveError('');
    if (pending === null) {
      setSelMin(null); setSelMax(null);
      setPending(min);
    } else if (pending === min) {
      setPending(null);
    } else {
      setSelMin(Math.min(pending, min));
      setSelMax(Math.max(pending, min));
      setPending(null);
    }
  };

  const previewMin = pending !== null && hovered !== null ? Math.min(pending, hovered) : null;
  const previewMax = pending !== null && hovered !== null ? Math.max(pending, hovered) : null;

  const getCellState = (min) => {
    if (selMin !== null && min >= selMin && min <= selMax) return 'confirmed';
    if (previewMin !== null && min >= previewMin && min <= previewMax) return 'preview';
    if (min === pending) return 'pending';
    return 'empty';
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (selMin === null || !actId) return;
    if (isCustom && (!customName.trim() || (control && !customGroup))) return;
    for (let m = selMin; m <= selMax; m++) {
      if (blockedMinMap[m]) { alert('선택한 시간대에 이미 기록이 있습니다.'); return; }
    }
    setSubmitting(true);
    const base = { date, startMin: selMin, endMin: selMax + 1 };
    setSaveError('');
    try {
      await onAddBlock(isCustom
        ? { ...base, activityId: null, customName: customName.trim(), customColor: control ? controlColor(customGroup) : customColor, ...(control ? { group: customGroup } : {}) }
        : { ...base, activityId: actId });
      setSelMin(null); setSelMax(null);
      if (isCustom) setCustomName('');
    } catch {
      setSaveError('기록을 저장하지 못했습니다. 공부 시간과 겹치는지 확인하고 다시 시도해 주세요.');
    } finally { setSubmitting(false); }
  };

  const clearAll = () => { setPending(null); setSelMin(null); setSelMax(null); };
  const dp = date.split('-');

  return (
    <div className="daily-schedule">
      <div className={`ds-header${control ? ' ds-header-control' : ''}`}>
        <span className="ds-date">{dp[0]}년 {parseInt(dp[1])}월 {parseInt(dp[2])}일</span>
        <div className={`ds-header-right${control ? ' ds-header-groups' : ''}`}>
          {control ? controlDaySummary.map(group => (
            <div className={`ds-summary-group ds-summary-group-${group.key}`} key={group.key}
              style={{ '--ds-group-color': controlColor(group.key) }}>
              <strong className="ds-summary-group-label">{group.name}</strong>
              <div className="ds-summary-group-activities">
                {group.items.length ? group.items.map(item => (
                  <span key={item.key} className="ds-summary-chip"
                    style={{ color: item.color, borderColor: item.color + '60', background: item.color + '15' }}>
                    {item.name} {fmtMins(item.mins)}
                  </span>
                )) : <span className="ds-summary-group-empty">기록 없음</span>}
              </div>
              <strong className="ds-summary-group-total">합계 {fmtMins(group.mins)}</strong>
            </div>
          )) : daySummary.map(s => (
            <span key={s.key} className="ds-summary-chip"
              style={{ color: s.color, borderColor: s.color + '60', background: s.color + '15' }}>
              {s.name} {fmtMins(s.mins)}
            </span>
          ))}
          {(pending !== null || selMin !== null) && (
            <button type="button" className="ds-clear-btn" onClick={clearAll}>선택 취소</button>
          )}
        </div>
      </div>

      <div className="ds-scroll">
        <div className="ds-table" onMouseLeave={() => setHovered(null)}>
          <div className="ds-th ds-th-time">시간</div>
          {MINUTES_ARR.map(m => {
            const isLabel = m % 15 === 0;
            const isQEnd  = m === 14 || m === 29 || m === 44;
            return (
              <div key={m} className={`ds-th${isLabel ? ' ds-th-quarter' : isQEnd ? ' ds-th-qend' : ' ds-th-minor'}`}>
                {isLabel ? `:${String(m).padStart(2, '0')}` : ''}
              </div>
            );
          })}

          {hours.map(hour => (
            <div key={hour} style={{ display: 'contents' }}>
              <div className="ds-td-time">{fmtHour(hour)}</div>
              {MINUTES_ARR.map(m => {
                const min    = (hour - 8) * 60 + m;
                const blk    = minMap[min];
                const info   = blk && (!blk._opposite || !['blind', 'hidden'].includes(oppositeMode))
                  ? blockActivity(blk, blk._opposite ? oppositeActMap : actMap) : null;
                const color  = info?.color;
                const name   = info?.name;
                const { startMin: blkStart, endMin: blkEnd } = blk ? getBlockMins(blk) : {};
                const isFirst  = blk && min === blkStart;
                const blkMid   = blk ? Math.floor((blkStart + blkEnd) / 2) : null;
                const showName = blk && min === blkMid && color && (blkEnd - blkStart) >= 5;

                const nextBlk      = minMap[min + 1];
                const sameRight    = !!blk && !!nextBlk && nextBlk.id === blk.id && nextBlk._opposite === blk._opposite
                  && !(blk._opposite && oppositeMode === 'hidden');
                const isQuarterEnd = m === 14 || m === 29 || m === 44;
                const isFiveEnd    = m % 5 === 4 && !isQuarterEnd;

                const visuallyHidden = blk?._opposite && oppositeMode === 'hidden';
                const state = blockedMinMap[min] && !visuallyHidden ? 'filled' : getCellState(min);
                const cls   = ['ds-td'];
                if (state === 'filled')              cls.push('ds-td-filled');
                if (blk?._opposite)                  cls.push('ds-td-opposite', `ds-td-opposite-${oppositeMode}`);
                if (blk?._opposite && control && oppositeMode !== 'hidden') cls.push('ds-td-opposite-locked');
                if (state === 'confirmed')           cls.push('ds-td-confirmed');
                if (state === 'preview')             cls.push('ds-td-preview');
                if (state === 'pending')             cls.push('ds-td-pending');
                if (isQuarterEnd && !sameRight)      cls.push('ds-td-quarter-end');
                if (isFiveEnd    && !sameRight)      cls.push('ds-td-five-end');

                return (
                  <div
                    key={m}
                    className={cls.join(' ')}
                    style={color ? { background: color + (blk?._opposite && oppositeMode === 'faded' ? '12' : '30') } : undefined}
                    onClick={() => handleCellClick(min)}
                    onMouseEnter={() => setHovered(min)}
                  >
                    {showName && (
                      <span className="ds-cell-name" style={{ color }}>{name}</span>
                    )}
                    {isFirst && !blk._opposite && (
                      <button
                        className="ds-del"
                        onClick={(e) => { e.stopPropagation(); onDeleteBlock(blk.id); }}
                      >✕</button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <form className="ds-form" onSubmit={handleAdd}>
        <div className="ds-form-row">
          {pending !== null ? (
            <span className="ds-sel-pending">
              📍 {minToTime(pending)} 선택됨 — 끝 셀을 클릭하세요
            </span>
          ) : selMin !== null ? (
            <span className="ds-sel-info">
              📌 {minToTime(selMin)} ~ {minToTime(selMax + 1)}
              <em> ({selMax - selMin + 1}분)</em>
            </span>
          ) : (
            <span className="ds-sel-hint">표에서 시작 셀을 클릭하세요</span>
          )}
        </div>
        <div className="ds-form-row">
          <select
            className="form-select-sm"
            style={control && actId && !isCustom ? { color: actMap[actId]?.color, fontWeight: 700 } : undefined}
            value={actId}
            onChange={(e) => setActId(e.target.value)}
            required
          >
            <option value="">활동 선택</option>
            {activities.map(a => <option key={a.id} value={a.id} style={control ? { color: a.color } : undefined}>{a.name}</option>)}
            <option value={CUSTOM_ID}>✏️ 직접 입력</option>
          </select>
          {isCustom && (
            <>
              <input
                className="form-input"
                style={{ width: '110px', padding: '8px 10px', fontSize: '0.85rem' }}
                placeholder="활동명"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                required
              />
              {control && <select className="form-select-sm" value={customGroup} onChange={e => setCustomGroup(e.target.value)} required>
                <option value="">그룹 선택</option><option value="controlled">통제</option><option value="foolish">어리석음</option>
              </select>}
              {!control && <div className="color-palette">
                {COLORS.map(c => (
                  <button key={c} type="button"
                    className={`color-dot ${c === customColor ? 'color-selected' : ''}`}
                    style={{ background: c, width: '16px', height: '16px' }}
                    onClick={() => setCustomColor(c)}
                  />
                ))}
              </div>}
            </>
          )}
          <button
            className="btn btn-login"
            type="submit"
            disabled={submitting || !actId || selMin === null || (isCustom && (!customName.trim() || (control && !customGroup)))}
          >
            {submitting ? '...' : '기록'}
          </button>
          {selMin !== null && (
            <button type="button" className="btn-cancel-sel" onClick={clearAll}>취소</button>
          )}
        </div>
      </form>
      {saveError && <p role="alert" className="ds-save-error">{saveError}</p>}
    </div>
  );
}

function PlannerTab({ uid, scheduleHistory, settingsReady, settingsError, control = false }) {
  const today = nowDateStr();
  const now   = effectiveNow();
  const [selectedDate, setSelectedDate] = useState(today);
  const [calYear,  setCalYear]  = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const plannerData = usePlanner(control ? null : uid, calYear, calMonth, selectedDate);
  const controlData = useControl(control ? uid : null, calYear, calMonth, selectedDate);
  const { activities, allActivities, blocks, oppositeBlocks, oppositeActivities, loading, error, retryLoading, addActivity,
    deleteActivity, addBlock, saveTimer, deleteBlock, updateActivityOrder, updateActivityGroup } =
    control ? controlData : plannerData;
  const displaySettings = oppositeDisplayFromHistory(scheduleHistory);
  const oppositeMode = control ? displaySettings.controlOppositeDisplay : displaySettings.plannerOppositeDisplay;

  const handleMonthChange = (delta) => {
    let mo = calMonth + delta, yr = calYear;
    if (mo < 0)  { mo = 11; yr--; }
    if (mo > 11) { mo = 0;  yr++; }
    setCalMonth(mo); setCalYear(yr);
  };


  return (
    <div className="planner-wrap">
      {control && <blockquote className="control-quote">
        “현명해지는 가장 확실한 방법은 <strong>어리석음을 제거하는 것이다.</strong> 좋은 선택을 하고자 하기보다 나쁜 선택을 일상적으로 피하고자 하는 것이 <span className="control-quote-end">낫다.” <cite>— 찰리 멍거</cite></span>
      </blockquote>}
      {error ? <div role="alert">
        기록을 불러오지 못했습니다. 연결 상태와 접근 권한을 확인해 주세요.
        <button type="button" onClick={retryLoading}>다시 시도</button>
      </div> : loading && <div role="status">기록을 불러오는 중...</div>}
      <ActivityManager activities={activities} onAdd={addActivity} onDelete={deleteActivity} onUpdateOrder={updateActivityOrder}
        onUpdateGroup={updateActivityGroup} control={control} />
      <div className="planner-main">
        <div className="planner-left">
          <TimerBlock activities={activities} allActivities={allActivities} onSaveTimer={saveTimer} control={control} />
          <PlannerCalendar
            year={calYear} month={calMonth} selectedDate={selectedDate}
            blocks={blocks} oppositeBlocks={oppositeBlocks} oppositeActivities={oppositeActivities} oppositeMode={oppositeMode}
            onSelectDate={setSelectedDate} onMonthChange={handleMonthChange} control={control}
          />
          {!loading && !error && <MonthlyStats year={calYear} month={calMonth} blocks={blocks} activities={allActivities} control={control} />}
        </div>
        <div className="planner-right">
          {!settingsReady && <p role="status">시간 설정을 불러오는 중…</p>}
          {settingsError && <p role="alert">시간 설정을 불러오지 못해 기본 범위로 표시합니다. 기존 기록은 유지됩니다. 설정 버튼에서 안내를 확인해 주세요.</p>}
          {!loading && !error && settingsReady && <DailySchedule
            key={selectedDate + JSON.stringify(rangeForDate(scheduleHistory, selectedDate))} range={rangeForDate(scheduleHistory, selectedDate)}
            date={selectedDate} blocks={blocks} oppositeBlocks={oppositeBlocks} oppositeActivities={oppositeActivities}
            oppositeMode={oppositeMode} activities={activities} allActivities={allActivities}
            onAddBlock={addBlock} onDeleteBlock={deleteBlock} control={control}
          />}
        </div>
      </div>
    </div>
  );
}

export default PlannerTab;
