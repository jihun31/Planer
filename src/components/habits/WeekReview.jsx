import { useState } from 'react';
import { percent, shortDay, weekReview } from '../../features/habits/habitCore.mjs';

// 지난주 돌아보기(Harkin 외 2016: 기록을 돌아볼 때 효과가 커진다). 주마다 한 번 닫을 수 있다.
const storageKey = (uid, from) => `planer:habit-review:${uid}:${from}`;
const readClosed = key => { try { return window.localStorage.getItem(key) === '1'; } catch { return false; } };

function Trend({ rate, prevRate }) {
  if (rate === null || prevRate === null) return <span className="habit-trend">처음</span>;
  const diff = Math.round((rate - prevRate) * 100);
  if (diff === 0) return <span className="habit-trend">그대로</span>;
  return <span className={`habit-trend ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? '▲' : '▼'} {Math.abs(diff)}%p</span>;
}

export default function WeekReview({ uid, habits, today }) {
  const review = weekReview(habits, today);
  const key = storageKey(uid, review.from);
  const [closedKey, setClosedKey] = useState(() => (readClosed(key) ? key : null));
  if (!review.items.length || closedKey === key) return null;
  const close = () => {
    try { window.localStorage.setItem(key, '1'); } catch { /* 이번 실행 동안만 닫힘 */ }
    setClosedKey(key);
  };

  return <section className="habit-review" aria-label="지난주 돌아보기">
    <div className="habit-review-hdr">
      <span className="habit-review-title">📊 지난주 돌아보기 <em>{shortDay(review.from)} ~ {shortDay(review.to)}</em></span>
      <span className="habit-review-total">전체 {percent(review.rate)}</span>
      <button type="button" className="modal-close" aria-label="지난주 돌아보기 닫기" onClick={close}>✕</button>
    </div>
    <ul className="habit-review-list">
      {review.items.map(item => <li key={item.habit.id}>
        <span className="habit-review-name">{item.habit.emoji} {item.habit.name}</span>
        <span className="habit-review-bar" aria-hidden="true"><i style={{ width: `${Math.round((item.rate ?? 0) * 100)}%` }} /></span>
        <span className="habit-review-num">{item.done}/{item.total} · {percent(item.rate)}</span>
        <Trend rate={item.rate} prevRate={item.prevRate} />
      </li>)}
    </ul>
  </section>;
}
