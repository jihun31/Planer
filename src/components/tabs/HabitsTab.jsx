import { useState } from 'react';
import HabitForm from '../habits/HabitForm';
import HabitRow from '../habits/HabitCard';
import HabitOverview from '../habits/HabitHistory';
import { AutomaticityPanel } from '../habits/AutomaticityCheck';
import { useSettingHelp } from '../SettingHelp';
import { useHabitCheck } from '../habits/useHabitCheck';
import WeekReview from '../habits/WeekReview';
import { orderHabits, scheduleLabel, totalDone } from '../../features/habits/habitCore.mjs';
import '../../styles/habits.css';

export default function HabitsTab({ uid, habitsData }) {
  const { habits, today, loading, error, orderReady, orderError, saveOrder,
    addHabit, updateHabit, archiveHabit, restoreHabit, deleteHabit, setLog, setAutomaticity } = habitsData;
  const check = useHabitCheck(setLog);
  const [editing, setEditing] = useState(null); // null | 'new' | 습관
  const [failure, setFailure] = useState('');
  const [orderDraft, setOrderDraft] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [openId, setOpenId] = useState(null);
  const help = useSettingHelp();
  const active = habits.filter(h => !h.archived);
  const archived = habits.filter(h => h.archived);
  const draftHabits = orderDraft && orderHabits(active, orderDraft);

  const run = async (action, message) => {
    setFailure('');
    try { await action(); } catch { setFailure(message); }
  };
  const remove = habit => {
    if (!window.confirm(`'${habit.name}' 습관과 기록 ${totalDone(habit)}회를 영구 삭제할까요? 되돌릴 수 없어요.`)) return;
    run(() => deleteHabit(habit.id), '습관을 삭제하지 못했어요.');
  };

  const startReordering = () => {
    setFailure('');
    setOrderDraft(active.map(habit => habit.id));
  };
  const cancelReordering = () => {
    setFailure('');
    setOrderDraft(null);
  };
  const moveHabit = (id, direction) => {
    setOrderDraft(draft => {
      const ids = orderHabits(active, draft).map(habit => habit.id);
      const from = ids.indexOf(id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= ids.length) return draft;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      return ids;
    });
  };
  const saveReordering = async () => {
    const ids = draftHabits.map(habit => habit.id);
    if (ids.every((id, index) => active[index].id === id)) {
      cancelReordering();
      return;
    }

    // 보관한 습관은 되돌렸을 때 원래 자리를 찾을 수 있게 유지한다.
    let index = 0;
    const savedIds = habits.map(habit => habit.archived ? habit.id : ids[index++]);
    setSavingOrder(true);
    await run(async () => {
      await saveOrder(savedIds);
      setOrderDraft(null);
    }, '습관 순서를 저장하지 못했어요. 다시 시도해 주세요.');
    setSavingOrder(false);
  };

  return <div className="habits-tab">
    <div className="habits-hdr">
      <div>
        <h2 className="habits-title setting-help-label">🔁 습관{help.button('intro', '습관')}</h2>
        {help.shown('intro') && <p className="habits-intro">작게 시작하고, 하루 빠져도 괜찮아요. 두 번 연속만 피하면 연속 기록이 이어져요.
          동그라미로 오늘을 기록하고, 이름을 누르면 최소만·쉬기·수정과 26주 기록이 펼쳐져요.</p>}
      </div>
      <div className="habits-hdr-actions">
        {draftHabits ? <>
          <button type="button" className="block-manage-btn" onClick={cancelReordering} disabled={savingOrder}>취소</button>
          <button type="button" className="btn btn-login" onClick={saveReordering} disabled={savingOrder || Boolean(orderError)}>
            {savingOrder ? '저장 중…' : '순서 저장'}
          </button>
        </> : <>
          {active.length > 1 && <button type="button" className="block-manage-btn" onClick={startReordering}
            disabled={!orderReady || Boolean(orderError)}>순서 변경</button>}
          <button type="button" className="btn btn-login" onClick={() => setEditing('new')}>+ 새 습관</button>
        </>}
      </div>
    </div>

    {error && <p role="alert">습관을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>}
    {orderError && <p role="alert" className="habit-error">습관 순서를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>}
    {(failure || check.failure) && <p role="alert" className="habit-error">{failure || check.failure}</p>}
    {!loading && !draftHabits && <WeekReview uid={uid} habits={habits} today={today} />}
    {!loading && !draftHabits && <AutomaticityPanel uid={uid} habits={active} today={today} onAnswer={setAutomaticity} />}
    {draftHabits ? <ol className="habit-order-list" aria-label="습관 순서 편집">
      {draftHabits.map((habit, index) => <li key={habit.id}>
        <span>{habit.emoji} {habit.name}</span>
        <button type="button" className="habit-edit-btn" aria-label={`${habit.name} 위로 이동`} title="위로 이동"
          disabled={savingOrder || index === 0} onClick={() => moveHabit(habit.id, -1)}>↑</button>
        <button type="button" className="habit-edit-btn" aria-label={`${habit.name} 아래로 이동`} title="아래로 이동"
          disabled={savingOrder || index === draftHabits.length - 1} onClick={() => moveHabit(habit.id, 1)}>↓</button>
      </li>)}
    </ol> : loading ? <p role="status" className="today-block-empty">불러오는 중…</p>
      : active.length === 0 ? <div className="habits-empty">
        <p>아직 습관이 없어요.</p>
        <p>이미 매일 하는 일(커피, 양치, 출근) 뒤에 붙일 <strong>아주 작은 행동</strong> 하나로 시작해 보세요.</p>
        <button type="button" className="btn btn-login" onClick={() => setEditing('new')}>첫 습관 만들기</button>
      </div>
      : <ul className="habits-list" aria-label="습관 목록">
        {active.map(habit => <HabitRow key={habit.id} habit={habit} today={today} check={check}
          open={openId === habit.id} onToggle={() => setOpenId(id => (id === habit.id ? null : habit.id))}
          onEdit={() => setEditing(habit)} />)}
      </ul>}
    {!loading && !draftHabits && active.length > 0 && <HabitOverview habits={active} today={today} />}

    {!draftHabits && archived.length > 0 && <details className="habits-archive">
      <summary>보관한 습관 {archived.length}개</summary>
      <ul>
        {archived.map(habit => <li key={habit.id}>
          <span>{habit.emoji} {habit.name} <em>{scheduleLabel(habit.schedule)} · 누적 {totalDone(habit)}회</em></span>
          <button type="button" className="block-manage-btn" onClick={() => run(() => restoreHabit(habit.id), '습관을 되돌리지 못했어요.')}>되돌리기</button>
          <button type="button" className="block-manage-btn danger" onClick={() => remove(habit)}>삭제</button>
        </li>)}
      </ul>
    </details>}

    {editing && <HabitForm habit={editing === 'new' ? null : editing} today={today} onClose={() => setEditing(null)}
      onArchive={editing === 'new' ? null : () => archiveHabit(editing.id)}
      onSave={value => (editing === 'new' ? addHabit(value) : updateHabit(editing.id, value))} />}
  </div>;
}
