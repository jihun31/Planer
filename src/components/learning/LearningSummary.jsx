import { duration } from '../../features/learning/learningStats.mjs';

// 시간 관리 화면 위의 학습 요약. 학습 탭 코드를 미리 받지 않도록 따로 둔다.
export default function LearningSummary({ learning, onOpen }) {
  const { stats:s, ready, error } = learning;
  return <button className="learning-summary" onClick={onOpen} type="button">
    <span className="learning-summary-title">학습 기록</span>
    {!ready ? <span>기록을 불러오는 중…</span> : error ? <span>기록 연결 확인이 필요해요</span> : <>
      <strong>{s.streak ? `${s.streak}일 연속 학습중` : '오늘부터 학습을 이어가세요'}</strong>
      <span>오늘 {duration(s.todayMinutes)}{s.goal ? ` / 목표 ${duration(s.goal.minutes)}` : ' · 목표 설정하기'}</span>
      {s.goal && <progress aria-label="오늘 학습 목표" value={Math.min(s.todayMinutes,s.goal.minutes)} max={s.goal.minutes} />}
    </>}
  </button>;
}
