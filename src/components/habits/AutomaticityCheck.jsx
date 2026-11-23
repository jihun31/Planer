import { useState } from 'react';
import { AUTOMATICITY_LABELS, automaticityDue, automaticityOf, weekStart } from '../../features/habits/habitCore.mjs';

// 주 1회 자동화 자가 체크. '나중에'는 이 기기에서 그 주 동안만 숨긴다.
const laterKey = (uid, habitId, week) => `planer:habit-auto-later:${uid}:${habitId}:${week}`;
const readLater = key => { try { return window.localStorage.getItem(key) === '1'; } catch { return false; } };

function AutomaticityCheck({ habit, week, onAnswer, onLater }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const answer = async score => {
    if (busy) return;
    setBusy(true);
    setFailure('');
    try { await onAnswer(habit.id, week, score); }
    catch { setFailure('저장하지 못했어요. 다시 눌러 주세요.'); }
    finally { setBusy(false); }
  };

  return <li className="habit-auto" role="group" aria-label={`${habit.name} 자동화 점검`}>
    <span className="habit-auto-name">{habit.emoji} {habit.name}</span>
    <div className="habit-auto-scale">
      {[1, 2, 3, 4, 5].map(score => <button key={score} type="button" className="habit-auto-btn" disabled={busy}
        title={AUTOMATICITY_LABELS[score]} aria-label={`${score}점 ${AUTOMATICITY_LABELS[score]}`} onClick={() => answer(score)}>{score}</button>)}
      <button type="button" className="habit-auto-later" onClick={onLater}>나중에</button>
    </div>
    {failure && <p role="alert" className="habit-error">{failure}</p>}
  </li>;
}

// 이번 주에 물어볼 습관을 한데 모은 한 줄. 누르면 습관마다 1~5점 단추가 펼쳐진다.
export function AutomaticityPanel({ uid, habits, today, onAnswer }) {
  const week = weekStart(today);
  // 숨김은 기기 저장소에서 읽는다. 저장소를 못 쓸 때만 이번 실행 동안 메모리에 둔다.
  const [unsaved, setUnsaved] = useState(() => new Set());
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const isHidden = habit => {
    const key = laterKey(uid, habit.id, week);
    return unsaved.has(key) || readLater(key);
  };
  const due = habits.filter(habit => automaticityDue(habit, today) && !isHidden(habit));
  if (!due.length) return null;
  const later = habit => {
    const key = laterKey(uid, habit.id, week);
    try { window.localStorage.setItem(key, '1'); setTick(n => n + 1); }
    catch { setUnsaved(previous => new Set(previous).add(key)); }
  };

  return <section className={`habit-auto-panel ${open ? 'open' : ''}`} aria-label="이번 주 자동화 점검">
    <button type="button" className="habit-auto-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span>🧭 이번 주 자동화 점검 <strong>{due.length}개</strong></span>
      <span className="habit-auto-toggle-hint">{open ? '접기' : '답하기'}</span>
    </button>
    {open && <>
      <p className="habit-auto-q">이제 <strong>생각하지 않아도 저절로</strong> 하게 되나요?
        <span className="habit-auto-ends">1 전혀 아니에요 · 5 완전히 그래요</span></p>
      <ul className="habit-auto-list">
        {due.map(habit => <AutomaticityCheck key={habit.id} habit={habit} week={week} onAnswer={onAnswer} onLater={() => later(habit)} />)}
      </ul>
    </>}
  </section>;
}

// 기록 보기 안의 점수 추이
export function AutomaticityTrend({ habit }) {
  const { history, settled } = automaticityOf(habit);
  if (!history.length) return <p className="habit-auto-trend">자동화 점검: 시작 일주일 뒤부터 매주 한 번 물어봐요.</p>;
  return <p className="habit-auto-trend">
    자동화 점검 {history.slice(-8).map(h => <span key={h.week} className={`habit-auto-dot s${h.score}`} title={`${h.week} 주 · ${h.score}점`}>{h.score}</span>)}
    {settled && <strong> · 자리 잡았어요</strong>}
  </p>;
}
