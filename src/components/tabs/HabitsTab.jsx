import { useState } from 'react';
import HabitForm from '../habits/HabitForm';
import HabitCard from '../habits/HabitCard';
import { useHabitCheck } from '../habits/useHabitCheck';
import WeekReview from '../habits/WeekReview';
import { byFrequency, scheduleLabel, totalDone } from '../../features/habits/habitCore.mjs';
import '../../styles/habits.css';

export default function HabitsTab({ uid, habitsData }) {
  const { habits, today, loading, error, addHabit, updateHabit, archiveHabit, restoreHabit, deleteHabit, setLog, setAutomaticity } = habitsData;
  const check = useHabitCheck(setLog);
  const [editing, setEditing] = useState(null); // null | 'new' | 습관
  const [failure, setFailure] = useState('');
  const active = byFrequency(habits.filter(h => !h.archived));
  const archived = habits.filter(h => h.archived);

  const run = async (action, message) => {
    setFailure('');
    try { await action(); } catch { setFailure(message); }
  };
  const remove = habit => {
    if (!window.confirm(`'${habit.name}' 습관과 기록 ${totalDone(habit)}회를 영구 삭제할까요? 되돌릴 수 없어요.`)) return;
    run(() => deleteHabit(habit.id), '습관을 삭제하지 못했어요.');
  };

  return <div className="habits-tab">
    <div className="habits-hdr">
      <div>
        <h2 className="habits-title">🔁 습관</h2>
        <p className="habits-intro">작게 시작하고, 하루 빠져도 괜찮아요. 두 번 연속만 피하면 연속 기록이 이어져요.</p>
      </div>
      <button type="button" className="btn btn-login" onClick={() => setEditing('new')}>+ 새 습관</button>
    </div>

    {error && <p role="alert">습관을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>}
    {(failure || check.failure) && <p role="alert" className="habit-error">{failure || check.failure}</p>}
    {!loading && <WeekReview uid={uid} habits={habits} today={today} />}
    {loading ? <p role="status" className="today-block-empty">불러오는 중…</p>
      : active.length === 0 ? <div className="habits-empty">
        <p>아직 습관이 없어요.</p>
        <p>이미 매일 하는 일(커피, 양치, 출근) 뒤에 붙일 <strong>아주 작은 행동</strong> 하나로 시작해 보세요.</p>
        <button type="button" className="btn btn-login" onClick={() => setEditing('new')}>첫 습관 만들기</button>
      </div>
      : <div className="habits-grid">
        {active.map(habit => <HabitCard key={habit.id} uid={uid} habit={habit} today={today} check={check} onAutomaticity={setAutomaticity}
          onEdit={() => setEditing(habit)} />)}
      </div>}

    {archived.length > 0 && <details className="habits-archive">
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
