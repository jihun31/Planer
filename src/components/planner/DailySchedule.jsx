import { useState, useMemo, useEffect } from 'react';
import { controlColor } from '../../features/planner/controlColors.mjs';
import { blockActivity, summarizeBlocks } from '../../features/planner/activityHistory.mjs';
import { visibleHours, blockMinutes as getBlockMins } from '../../features/planner/scheduleTime.mjs';
import { COLORS, MINUTES_ARR, CUSTOM_ID, minToTime, fmtHour, fmtMins } from './plannerDisplay.mjs';

function DailySchedule({ date, range, blocks, oppositeBlocks, oppositeActivities, oppositeMode, activities, allActivities, onAddBlock, onDeleteBlock, control = false }) {
  const [pending, setPending]         = useState(null);
  const [hovered, setHovered]         = useState(null);
  const [selMin, setSelMin]           = useState(null);
  const [selMax, setSelMax]           = useState(null);
  const [actId, setActId]             = useState('');
  const [customName, setCustomName]   = useState('');
  const [customColor, setCustomColor] = useState(COLORS[0]);
  const [customGroup, setCustomGroup] = useState('');
  const [customLearning, setCustomLearning] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [deletingBlockId, setDeletingBlockId] = useState(null);
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
        ? { ...base, activityId: null, customName: customName.trim(), customColor: control ? controlColor(customGroup) : customColor, ...(control ? { group: customGroup } : { learningIncluded: customLearning }) }
        : { ...base, activityId: actId });
      setSelMin(null); setSelMax(null);
      if (isCustom) { setCustomName(''); setCustomLearning(false); }
    } catch {
      setSaveError('기록을 저장하지 못했습니다. 공부 시간과 겹치는지 확인하고 다시 시도해 주세요.');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (blockId) => {
    if (deletingBlockId) return;
    setDeletingBlockId(blockId);
    setSaveError('');
    try { await onDeleteBlock(blockId); }
    catch { setSaveError('기록을 삭제하지 못했습니다. 연결 상태와 접근 권한을 확인한 뒤 다시 시도해 주세요.'); }
    finally { setDeletingBlockId(null); }
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
                        type="button"
                        aria-label={`${name || '기록'} 삭제`}
                        disabled={deletingBlockId === blk.id}
                        onClick={(e) => { e.stopPropagation(); handleDelete(blk.id); }}
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
            onChange={(e) => { setActId(e.target.value); if (e.target.value !== CUSTOM_ID) setCustomLearning(false); }}
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
              {!control && <label className="learning-custom-checkbox"><input type="checkbox" checked={customLearning} onChange={e => setCustomLearning(e.target.checked)} /> 학습 기록에 포함</label>}
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

export default DailySchedule;
