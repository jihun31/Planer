// Flowtime식 집중·휴식 연결: 일한 시간에 맞춰 휴식 길이를 정하고, 오래 일하면 부드럽게 알린다.
const minute = 60_000;

// 이보다 짧게 일하고 멈추면(잘못 누른 시작 등) 휴식을 자동으로 시작하지 않는다.
export const FLOW_REST_MIN_WORK_MINUTES = 5;

// 일한 시간(분) 미만이면 그 휴식 길이(분). Flowtime에서 흔히 쓰는 단계다.
const restSteps = [[25, 5], [50, 8], [90, 10]];
const longRest = 15;

export function flowRestMinutes(workMs) {
  if (!Number.isFinite(workMs) || workMs < FLOW_REST_MIN_WORK_MINUTES * minute) return null;
  const worked = workMs / minute;
  return restSteps.find(([limit]) => worked < limit)?.[1] ?? longRest;
}

export const BREAK_NUDGE_OPTIONS = [25, 30, 45, 50, 60, 90];
export const DEFAULT_BREAK_NUDGE_MINUTES = 50;
export const isBreakNudgeMinutes = value => BREAK_NUDGE_OPTIONS.includes(value);

export function breakNudgeText(minutes) {
  return `${minutes}분 지났어요 · 쉬어 갈까요?`;
}
