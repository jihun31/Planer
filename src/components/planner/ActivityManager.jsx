import { useState, useEffect } from 'react';
import { controlColor } from '../../features/planner/controlColors.mjs';
import { COLORS } from './plannerDisplay.mjs';

function ActivityManager({ activities, onAdd, onDelete, onUpdateOrder, onUpdateGroup, onStart, control = false }) {
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
  const addDisabled = reordering || changingGroups || submitting;

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
    try { await onUpdateOrder(localIds.filter(id => activities.some(activity => activity.id === id))); }
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
    if (addDisabled || !name.trim() || (control && !group)) return;
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
                <button type="button" className="act-chip-start" aria-label={`${a.name} 선택 시간 기록 또는 타이머 시작`}
                  title="시간표에서 선택한 칸이 있으면 바로 기록하고, 없으면 타이머를 시작합니다."
                  disabled={!onStart || reordering || changingGroups || !!deleteBusyId || !!groupBusyId}
                  onClick={() => onStart(a.id)}>{a.name}</button>
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
          {(activities.length > 0 || reordering) && (
            <button type="button"
              className={`act-reorder-btn${reordering ? ' act-reorder-active' : ''}`}
              onClick={reordering ? handleDone : () => setReordering(true)} disabled={changingGroups || !!deleteBusyId || submitting}
              title={reordering ? '순서 변경 완료' : '활동 순서 수정'}
            >
              {reordering ? '완료' : '✎'}
            </button>
          )}
          {control && (activities.length > 0 || changingGroups) && <button type="button"
            className={`act-reorder-btn${changingGroups ? ' act-reorder-active' : ''}`}
            onClick={() => setChangingGroups(value => !value)} disabled={reordering || !!groupBusyId || submitting}
            title={changingGroups ? '그룹 변경 완료' : '활동 그룹 변경'}>
            {changingGroups ? '완료' : '그룹 변경'}
          </button>}
        </div>
      </div>
      <form className="act-add-form" onSubmit={handleAdd}>
        {control && <select className="form-select-sm" value={group} onChange={e => setGroup(e.target.value)} required disabled={addDisabled}>
          <option value="">그룹 선택</option><option value="controlled">통제</option><option value="foolish">어리석음</option>
        </select>}
        {!control && <div className="color-palette">
          {COLORS.map(c => (
            <button key={c} type="button" disabled={addDisabled}
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
          disabled={addDisabled}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="btn btn-login" type="submit" disabled={addDisabled}>
          {submitting ? '...' : '+ 추가'}
        </button>
      </form>
      {actionError && <p role="alert" className="act-error">{actionError}</p>}
    </div>
  );
}

export default ActivityManager;
