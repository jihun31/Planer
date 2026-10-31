// 앱이 Firestore에 쓰는 문서 모양 (보안 규칙 validPlan·checkIns·offDays와 같은 형식).
// tests/tonkatsu.rules.test.mjs가 이 함수들로 만든 문서가 실제 규칙을 통과하는지 확인합니다.
// ts: serverTimestamp() 값, del: deleteField() 값 (테스트와 앱에서 각자 넣어줌)

const EXTRA_KEYS = { Daily: [], Weekly: ['count'], Monthly: ['count'], Routine: ['days'], Interval: ['interval'], OneTime: ['deadline'], Limit: ['period', 'limit'] };

/** 입력 확인. 문제가 있으면 안내 문구, 없으면 null */
export function planInputError(input) {
  const content = (input.content || '').trim();
  if (!content) return '내용을 입력해 주세요.';
  if (content.length > 80) return '내용은 80자까지 쓸 수 있어요.';
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  switch (input.category) {
    case 'Daily': return null;
    case 'Weekly': return int(input.count, 1, 7) ? null : '주간 목표는 1~7회로 정해 주세요.';
    case 'Monthly': return int(input.count, 1, 31) ? null : '월간 목표는 1~31회로 정해 주세요.';
    case 'Routine': return input.days?.length ? null : '요일을 하나 이상 골라 주세요.';
    case 'Interval': return int(input.interval, 1, 365) ? null : '간격은 1~365일로 정해 주세요.';
    case 'OneTime': return /^\d{4}-\d{2}-\d{2}$/.test(input.deadline || '') ? null : '마감일을 골라 주세요.';
    case 'Limit':
      if (!['day', 'week', 'month'].includes(input.period)) return '제한 기간을 골라 주세요.';
      return int(input.limit, 0, 50) ? null : '제한 횟수는 0~50회로 정해 주세요.';
    default: return '계획 종류를 골라 주세요.';
  }
}

export function planDoc(ownerId, input, startDate, ts) {
  const data = {
    ownerId, category: input.category, content: input.content.trim(),
    photo: input.category === 'Limit' ? false : !!input.photo,
    startDate, status: 'active', createdAt: ts, updatedAt: ts,
  };
  for (const key of EXTRA_KEYS[input.category]) data[key] = input[key];
  if (input.category === 'Routine') data.days = ['월', '화', '수', '목', '금', '토', '일'].filter((d) => input.days.includes(d));
  return data;
}

/** 인증 기록. id가 null이면 자동 ID (제한 계획) */
export function checkInDoc(plan, ownerId, date, ts) {
  return {
    id: plan.category === 'Limit' ? null : `${plan.id}_${date}`,
    data: { planId: plan.id, ownerId, date, source: 'app', createdAt: ts },
  };
}

export const goalCompleteUpdate = (date, ts) => ({ status: 'completed', completedAt: date, updatedAt: ts });
export const goalUndoUpdate = (ts, del) => ({ status: 'active', completedAt: del, updatedAt: ts });
export const planDeleteUpdate = (ts) => ({ status: 'deleted', updatedAt: ts });

export function restDoc(ownerId, date, ts) {
  return { id: `${ownerId}_rest_${date.slice(0, 7)}`, data: { ownerId, type: 'rest', date, createdAt: ts } };
}
