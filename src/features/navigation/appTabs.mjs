// 앱 탭 정의를 한 곳에 모은다. 탭을 추가할 때는 여기에 한 줄을 넣고 App.jsx의 panels에 화면을 연결한다.
// - 보기(view): 실제로 보이는 화면. 탭 안에 하위 화면(views)이 없으면 탭 id가 곧 보기 id다.
// - hideable: 설정에서 숨길 수 있는 보기. 저장 키는 보기 id라서 바꾸면 기존 숨김 설정이 사라진다.
// - requires: 'discord'면 디스코드 연동 계정에만 보인다.
// - eager: 앱을 열 때 바로 그린다. 나머지는 처음 열 때 그린다.
// 배열 순서가 기본 탭 순서다. 사용자는 설정에서 순서를 바꿀 수 있다(탭 id로 저장).
export const APP_TABS = [
  { id: 'today', label: '📋 오늘 할 일', eager: true },
  { id: 'time', label: '🕐 시간 관리', views: [
    { id: 'planner', label: '기록' },
    { id: 'control', label: '통제', hideable: true },
  ] },
  { id: 'habits', label: '🔁 습관', hideable: true },
  { id: 'notes', label: '📝 메모', hideable: true },
  { id: 'calendar', label: '📅 캘린더', hideable: true },
  { id: 'learning', label: '🌱 학습 기록' },
  { id: 'checkin', label: '🔥 인증', requires: 'discord' },
];

export const HOME_VIEW = 'today';
export const DEFAULT_TAB_ORDER = APP_TABS.map(tab => tab.id);

// 저장된 순서를 정리한다. 모르는 id·중복은 버리고, 빠진 탭(나중에 추가된 탭 등)은
// 기본 순서에서 바로 앞에 있던 탭 뒤에 끼운다.
export function normalizeTabOrder(order) {
  const result = [];
  for (const id of Array.isArray(order) ? order : []) {
    if (DEFAULT_TAB_ORDER.includes(id) && !result.includes(id)) result.push(id);
  }
  DEFAULT_TAB_ORDER.forEach((id, index) => {
    if (result.includes(id)) return;
    const before = DEFAULT_TAB_ORDER.slice(0, index).reverse().find(prev => result.includes(prev));
    result.splice(before ? result.indexOf(before) + 1 : 0, 0, id);
  });
  return result;
}

export const orderTabs = order => normalizeTabOrder(order).map(id => APP_TABS.find(tab => tab.id === id));

// candidates(설정 화면에 보이는 탭) 안에서 이웃한 탭과 자리를 바꾼다. 보이지 않는 탭은 건너뛴다.
export function moveTab(order, tabId, delta, candidates = DEFAULT_TAB_ORDER) {
  const list = normalizeTabOrder(order);
  const shown = list.filter(id => candidates.includes(id));
  const from = shown.indexOf(tabId), to = from + delta;
  if (from < 0 || to < 0 || to >= shown.length) return list;
  const a = list.indexOf(shown[from]), b = list.indexOf(shown[to]);
  [list[a], list[b]] = [list[b], list[a]];
  return list;
}

export const tabAvailable = (tab, context) => !tab.requires || Boolean(context?.[tab.requires]);

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
