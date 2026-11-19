import { HIDEABLE_VIEW_IDS } from './appTabs.mjs';

// 숨길 수 있는 보기(appTabs.mjs의 hideable)마다 표시 여부를 읽는다. 값이 없거나 깨졌으면 모두 표시한다.
export function readTabVisibility(value) {
  let data = null;
  try { data = JSON.parse(value); } catch { /* 기본값 사용 */ }
  return Object.fromEntries(HIDEABLE_VIEW_IDS.map(id => [id, data?.[id] !== false]));
}
