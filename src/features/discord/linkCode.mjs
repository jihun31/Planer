// 디스코드 연동 코드: 8자리, 헷갈리는 I·O·0·1 제외 (보안 규칙 linkCodes와 같은 형식)
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LINK_CODE_LENGTH = 8;
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;

export function generateLinkCode(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  // 32글자라 256을 정확히 나눠서 편향이 없음
  return Array.from(random(LINK_CODE_LENGTH), (b) => LINK_CODE_ALPHABET[b % LINK_CODE_ALPHABET.length]).join('');
}

export function isLinkCode(value) {
  return typeof value === 'string' && /^[A-HJ-NP-Z2-9]{8}$/.test(value);
}

// 화면 표시용 "ABCD-2345"
export function formatLinkCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function remainingSeconds(createdAtMs, nowMs = Date.now()) {
  return Math.max(0, Math.ceil((createdAtMs + LINK_CODE_TTL_MS - nowMs) / 1000));
}
