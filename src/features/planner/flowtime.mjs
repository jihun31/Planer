// Flowtime식 집중·휴식 연결: 일한 시간에 맞춰 휴식 길이를 정하고, 오래 일하면 부드럽게 알린다.
const minute = 60_000;

// 이보다 짧게 일하고 멈추면(잘못 누른 시작 등) 휴식을 자동으로 시작하지 않는다.
export const FLOW_REST_MIN_WORK_MINUTES = 5;

// 휴식은 일한 시간의 20%(분 단위 반올림), 5~20분 사이로 정한다.
// 스스로 쉬는 때를 고른 학생들이 일한 시간의 약 18%를 쉬었다(Smits 외, 2025).
// 단계식(25분 미만 5분 등)은 경계에서 2분 차이로 휴식이 3분씩 뛰어 비율로 바꿨다.
const REST_RATIO = 0.2;
const MIN_REST_MINUTES = 5;
const MAX_REST_MINUTES = 20;

export function flowRestMinutes(workMs) {
  if (!Number.isFinite(workMs) || workMs < FLOW_REST_MIN_WORK_MINUTES * minute) return null;
  const rest = Math.round(workMs / minute * REST_RATIO);
  return Math.min(MAX_REST_MINUTES, Math.max(MIN_REST_MINUTES, rest));
}

// 알림 시점은 사용자가 분 단위 정수로 직접 입력한다.
export const BREAK_NUDGE_MIN_MINUTES = 1;
export const BREAK_NUDGE_MAX_MINUTES = 240;
export const DEFAULT_BREAK_NUDGE_MINUTES = 50;
export const isBreakNudgeMinutes = value => Number.isInteger(value)
  && value >= BREAK_NUDGE_MIN_MINUTES && value <= BREAK_NUDGE_MAX_MINUTES;

export function breakNudgeText(minutes) {
  return `${minutes}분 지났어요 · 쉬어 갈까요?`;
}
