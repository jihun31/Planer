// 앱 탭 정의를 한 곳에 모은다. 탭을 추가할 때는 여기에 한 줄을 넣고 App.jsx의 panels에 화면을 연결한다.
// - 보기(view): 실제로 보이는 화면. 탭 안에 하위 화면(views)이 없으면 탭 id가 곧 보기 id다.
// - hideable: 설정에서 숨길 수 있는 보기. 저장 키는 보기 id라서 바꾸면 기존 숨김 설정이 사라진다.
// - requires: 'discord'면 디스코드 연동 계정에만 보인다.
// - eager: 앱을 열 때 바로 그린다. 나머지는 처음 열 때 그린다.
export const APP_TABS = [
  { id: 'today', label: '📋 오늘 할 일', eager: true },
  { id: 'time', label: '🕐 시간 관리', views: [
    { id: 'planner', label: '🕐 기록' },
    { id: 'control', label: '🧭 통제', hideable: true },
  ] },
  { id: 'learning', label: '🌱 학습 기록' },
  { id: 'habits', label: '🔁 습관', hideable: true },
  { id: 'notes', label: '📝 메모', hideable: true },
  { id: 'calendar', label: '📅 캘린더', hideable: true },
  { id: 'checkin', label: '🔥 인증', requires: 'discord' },
];

export const HOME_VIEW = 'today';

export const tabViews = tab => (tab.views ?? [{ id: tab.id, label: tab.label }])
  .map(view => ({ ...view, tabId: tab.id, eager: view.eager ?? tab.eager ?? false,
    hideable: view.hideable ?? (!tab.views && tab.hideable) ?? false, requires: view.requires ?? tab.requires }));

export const allViews = (tabs = APP_TABS) => tabs.flatMap(tabViews);

export const HIDEABLE_VIEW_IDS = allViews().filter(view => view.hideable).map(view => view.id);

const meetsRequirement = (view, context) => !view.requires || Boolean(context?.[view.requires]);

// 연동 조건에 맞는 보기 전체(숨김 설정과 무관). 화면을 붙여 둘 대상이다.
export const availableViews = (context, tabs = APP_TABS) => allViews(tabs).filter(view => meetsRequirement(view, context));

// 숨김 설정과 연동 조건을 적용한 탭 목록. 보이는 보기가 하나도 없는 탭은 뺀다.
export function visibleTabs(visibility, context, tabs = APP_TABS) {
  return tabs.map(tab => ({ ...tab, views: tabViews(tab)
    .filter(view => meetsRequirement(view, context) && (!view.hideable || visibility?.[view.id] !== false)) }))
    .filter(tab => tab.views.length > 0);
}

// Tab / Shift+Tab으로 오가는 순서: 하위 화면까지 펼친 보기 id 목록
export const viewOrder = tabs => tabs.flatMap(tab => tab.views.map(view => view.id));

export const tabOfView = (tabs, viewId) => tabs.find(tab => tab.views.some(view => view.id === viewId)) ?? null;

// 보이지 않는 보기면 같은 탭의 첫 보기로, 탭째 안 보이면 홈으로 보낸다.
export function resolveView(tabs, viewId) {
  if (tabOfView(tabs, viewId)) return viewId;
  const owner = APP_TABS.find(tab => tabViews(tab).some(view => view.id === viewId));
  return tabs.find(tab => tab.id === owner?.id)?.views[0].id ?? HOME_VIEW;
}

export function stepView(tabs, viewId, delta) {
  const order = viewOrder(tabs);
  const index = order.indexOf(viewId);
  return order[(index + delta + order.length) % order.length];
}

// 상단 탭을 누르면 그 탭에서 마지막으로 본 화면으로 간다.
export function viewForTab(tab, lastViewByTab) {
  const last = lastViewByTab?.[tab.id];
  return tab.views.some(view => view.id === last) ? last : tab.views[0].id;
}
