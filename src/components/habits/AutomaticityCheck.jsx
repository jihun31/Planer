import { useState } from 'react';
import { AUTOMATICITY_LABELS, automaticityDue, automaticityOf, weekStart } from '../../features/habits/habitCore.mjs';

// 주 1회 자동화 자가 체크. '나중에'는 이 기기에서 그 주 동안만 숨긴다.
const laterKey = (uid, habitId, week) => `planer:habit-auto-later:${uid}:${habitId}:${week}`;
const readLater = key => { try { return window.localStorage.getItem(key) === '1'; } catch { return false; } };

export function AutomaticityCheck({ uid, habit, today, onAnswer }) {
  const week = weekStart(today);
  const key = laterKey(uid, habit.id, week);
  const [hiddenKey, setHiddenKey] = useState(() => (readLater(key) ? key : null));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  if (!automaticityDue(habit, today) || hiddenKey === key) return null;

  const answer = async score => {
    if (busy) return;
    setBusy(true);
    setFailure('');
    try { await onAnswer(habit.id, week, score); }
    catch { setFailure('저장하지 못했어요. 다시 눌러 주세요.'); }
    finally { setBusy(false); }
  };
  const later = () => {
    try { window.localStorage.setItem(key, '1'); } catch { /* 이번 실행 동안만 숨김 */ }
    setHiddenKey(key);
  };

  return <div className="habit-auto" role="group" aria-label={`${habit.name} 자동화 점검`}>
    <p className="habit-auto-q">이번 주 점검 · 이제 <strong>생각하지 않아도 저절로</strong> 하게 되나요?</p>
    <div className="habit-auto-scale">
      {[1, 2, 3, 4, 5].map(score => <button key={score} type="button" className="habit-auto-btn" disabled={busy}
        title={AUTOMATICITY_LABELS[score]} aria-label={`${score}점 ${AUTOMATICITY_LABELS[score]}`} onClick={() => answer(score)}>{score}</button>)}
      <button type="button" className="habit-auto-later" onClick={later}>나중에</button>
    </div>
    <div className="habit-auto-ends" aria-hidden="true"><span>전혀 아니에요</span><span>완전히 그래요</span></div>
    {failure && <p role="alert" className="habit-error">{failure}</p>}
  </div>;
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
