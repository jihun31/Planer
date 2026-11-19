import LearningMedal from '../learning/LearningMedal.jsx';
import { BADGE_MILESTONES, badgesOf } from '../../features/habits/habitCore.mjs';

// 누적 횟수 배지(7·30·66·100회). 학습 탭의 메달 그림을 함께 쓴다.
export default function HabitBadges({ habit }) {
  const { earned, next } = badgesOf(habit);
  return <div className="habit-badges" aria-label={`배지 ${earned.length}개`}>
    {BADGE_MILESTONES.map(b => {
      const has = earned.includes(b);
      return <span key={b.count} className={`habit-medal ${has ? 'earned' : ''}`}
        title={has ? `누적 ${b.count}회 배지` : `누적 ${b.count}회에 받아요`}>
        <LearningMedal tier={b.tier} />
      </span>;
    })}
    <span className="habit-badges-next">{next ? `다음 배지까지 ${next.remaining}회` : '모든 배지를 모았어요'}</span>
  </div>;
}

export function BadgeToast({ habit, milestone }) {
  if (!milestone) return null;
  return <div className="habit-badge-toast" role="status">
    <span className="habit-medal earned"><LearningMedal tier={milestone.tier} /></span>
    <span><strong>{habit.emoji} {habit.name}</strong> 누적 {milestone.count}회 배지를 받았어요!</span>
  </div>;
}
