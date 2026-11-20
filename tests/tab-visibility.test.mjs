import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readTabOrder, readTabVisibility } from '../src/features/navigation/tabVisibility.mjs';
import { APP_TABS, DEFAULT_TAB_ORDER, HIDEABLE_VIEW_IDS, HOME_VIEW, availableViews, moveTab, normalizeTabOrder, orderTabs,
  resolveView, stepView, tabAvailable, tabOfView, viewForTab, viewOrder, visibleTabs } from '../src/features/navigation/appTabs.mjs';

const allShown = {control:true,habits:true,calendar:true,notes:true};
const topIds = tabs => tabs.map(tab => tab.id);

test('one registry defines the tabs; planner and control live under one time-management tab', () => {
  assert.equal(new Set(APP_TABS.map(tab => tab.id)).size,APP_TABS.length);
  assert.deepEqual(HIDEABLE_VIEW_IDS,['control','habits','notes','calendar']);
  const tabs = visibleTabs(allShown,{discord:false});
  // 학습 기록은 기본적으로 인증 바로 왼쪽(맨 뒤쪽)
  assert.deepEqual(topIds(tabs),['today','time','habits','notes','calendar','learning']);
  assert.deepEqual(tabs.find(tab => tab.id === 'time').views.map(view => view.id),['planner','control']);
  assert.deepEqual(viewOrder(tabs),['today','planner','control','habits','notes','calendar','learning']);
  assert.equal(tabOfView(tabs,'control').id,'time');
  // 디스코드 연동 탭은 연동했을 때만
  assert.deepEqual(topIds(visibleTabs(allShown,{discord:true})),['today','time','habits','notes','calendar','learning','checkin']);
  assert.deepEqual(availableViews({discord:false}).map(view => view.id),['today','planner','control','habits','notes','calendar','learning']);
  assert.ok(availableViews({discord:true}).some(view => view.id === 'checkin'));
  assert.deepEqual(availableViews({}).filter(view => view.eager).map(view => view.id),['today']);
  assert.equal(tabAvailable(APP_TABS.find(tab => tab.id === 'checkin'),{discord:false}),false);
});

test('only optional views are hidden, preserving navigation order and the default visible views', () => {
  assert.deepEqual(readTabVisibility(null),allShown);
  assert.deepEqual(readTabVisibility('invalid'),allShown);
  assert.deepEqual(readTabVisibility('{"notes":false}'),{control:true,habits:true,calendar:true,notes:false});
  const order = visibility => viewOrder(visibleTabs(visibility,{}));
  assert.deepEqual(order({control:false,notes:false}),['today','planner','habits','calendar','learning']);
  assert.deepEqual(order({habits:false}),['today','planner','control','notes','calendar','learning']);
  assert.deepEqual(order({control:false,notes:true}),['today','planner','habits','notes','calendar','learning']);
  assert.deepEqual(order({control:true,calendar:false,notes:true}),['today','planner','control','habits','notes','learning']);
  // 통제를 숨겨도 시간 관리 탭은 남고 하위 화면은 기록 하나뿐
  const noControl = visibleTabs({control:false},{});
  assert.deepEqual(noControl.find(tab => tab.id === 'time').views.map(view => view.id),['planner']);
});

test('navigation moves through sub-views, remembers the last one per tab, and falls back when hidden', () => {
  const tabs = visibleTabs(allShown,{});
  assert.equal(stepView(tabs,'planner',1),'control');
  assert.equal(stepView(tabs,'control',1),'habits');
  assert.equal(stepView(tabs,'habits',-1),'control');
  assert.equal(stepView(tabs,'today',-1),'learning');
  assert.equal(stepView(tabs,'learning',1),'today');
  const time = tabs.find(tab => tab.id === 'time');
  assert.equal(viewForTab(time,{}),'planner');
  assert.equal(viewForTab(time,{time:'control'}),'control');
  assert.equal(viewForTab(visibleTabs({control:false},{}).find(tab => tab.id === 'time'),{time:'control'}),'planner');
  assert.equal(resolveView(tabs,'control'),'control');
  assert.equal(resolveView(visibleTabs({control:false},{}),'control'),'planner');
  assert.equal(resolveView(visibleTabs({notes:false},{}),'notes'),HOME_VIEW);
  assert.equal(resolveView(tabs,'checkin'),HOME_VIEW);
  assert.equal(resolveView(tabs,'unknown'),HOME_VIEW);
});

test('a saved tab order reorders navigation, survives bad data, and keeps tabs added later', () => {
  assert.deepEqual(DEFAULT_TAB_ORDER,['today','time','habits','notes','calendar','learning','checkin']);
  assert.deepEqual(readTabOrder(null),DEFAULT_TAB_ORDER);
  assert.deepEqual(readTabOrder('not-json'),DEFAULT_TAB_ORDER);
  assert.deepEqual(readTabOrder('{"a":1}'),DEFAULT_TAB_ORDER);
  // 모르는 id·중복은 버리고 빠진 탭은 기본 순서상 앞 탭 뒤에 끼운다
  assert.deepEqual(normalizeTabOrder(['learning','today','ghost','learning','time']),
    ['learning','checkin','today','time','habits','notes','calendar']);
  assert.deepEqual(normalizeTabOrder(['calendar']),['today','time','habits','notes','calendar','learning','checkin']);
  const saved = ['learning','today','time','habits','notes','calendar','checkin'];
  const tabs = visibleTabs(allShown,{},orderTabs(saved));
  assert.deepEqual(topIds(tabs),['learning','today','time','habits','notes','calendar']);
  assert.equal(stepView(tabs,'learning',1),'today');
  assert.equal(stepView(tabs,'calendar',1),'learning');
});

test('moving a tab swaps it with the neighbour shown in settings and stops at the ends', () => {
  assert.deepEqual(moveTab(null,'learning',-1),['today','time','habits','notes','learning','calendar','checkin']);
  assert.deepEqual(moveTab(null,'time',-1),['time','today','habits','notes','calendar','learning','checkin']);
  assert.deepEqual(moveTab(null,'today',-1),DEFAULT_TAB_ORDER);
  assert.deepEqual(moveTab(null,'checkin',1),DEFAULT_TAB_ORDER);
  assert.deepEqual(moveTab(null,'ghost',1),DEFAULT_TAB_ORDER);
  // 디스코드 미연동이면 인증 탭은 목록에 없으므로, 학습 기록은 맨 뒤에서 더 내려가지 않는다
  const shown = DEFAULT_TAB_ORDER.filter(id => id !== 'checkin');
  assert.deepEqual(moveTab(null,'learning',1,shown),DEFAULT_TAB_ORDER);
  // 보이지 않는 탭을 건너뛰고 보이는 이웃과 자리를 바꾼다
  assert.deepEqual(moveTab(['today','checkin','time','habits','notes','calendar','learning'],'time',-1,shown),
    ['time','checkin','today','habits','notes','calendar','learning']);
});

function loadHook(file,name,globals) {
  const storage = new Map(), events = [];
  const context = vm.createContext({...globals,Event,
    window:{localStorage:{getItem:key => storage.get(key) ?? null,setItem:(key,value) => storage.set(key,value),removeItem:key => storage.delete(key)},
      dispatchEvent:event => events.push(event.type)},
    useSyncExternalStore:(_subscribe,read) => read(),useMemo:create => create()});
  const source = fs.readFileSync(file,'utf8').replace(/import[^;]+;/g,'').replace('export function','function');
  vm.runInContext(source + `\nglobalThis.hook = ${name};`,context);
  return {hook:context.hook,events,storage};
}

test('tab choices survive reopening, remain account-specific, and notify mounted navigation', () => {
  const {hook,events} = loadHook('src/features/navigation/useTabVisibility.js','useTabVisibility',{readTabVisibility,HIDEABLE_VIEW_IDS});
  let [value,set] = hook('alice');
  assert.equal(value.notes,true);set('notes',false);set('control',false);set('calendar',false);
  assert.equal(hook('alice')[0].notes,false);
  assert.equal(hook('alice')[0].control,false);
  assert.equal(hook('alice')[0].calendar,false);
  assert.equal(hook('bob')[0].notes,true);
  assert.equal(hook('bob')[0].calendar,true);
  assert.throws(() => set('planner',false));
  assert.deepEqual(events,['planer:tab-visibility','planer:tab-visibility','planer:tab-visibility']);
});

test('tab order survives reopening per account and can be reset to the default', () => {
  const {hook,events,storage} = loadHook('src/features/navigation/useTabOrder.js','useTabOrder',{readTabOrder});
  const [order,set] = hook('alice');
  assert.deepEqual(order,DEFAULT_TAB_ORDER);
  set(moveTab(order,'learning',-1));
  assert.deepEqual(hook('alice')[0],['today','time','habits','notes','learning','calendar','checkin']);
  assert.deepEqual(hook('bob')[0],DEFAULT_TAB_ORDER);
  set(['ghost','calendar']);
  assert.deepEqual(JSON.parse(storage.get('planer:tab-order:alice')),normalizeTabOrder(['calendar']));
  set(null);
  assert.equal(storage.has('planer:tab-order:alice'),false);
  assert.deepEqual(hook('alice')[0],DEFAULT_TAB_ORDER);
  assert.throws(() => set('today'));
  assert.throws(() => hook(null)[1]([]));
  assert.deepEqual(events,['planer:tab-order','planer:tab-order','planer:tab-order']);
});
