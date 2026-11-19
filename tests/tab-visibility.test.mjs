import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readTabVisibility } from '../src/features/navigation/tabVisibility.mjs';
import { APP_TABS, HIDEABLE_VIEW_IDS, HOME_VIEW, availableViews, resolveView, stepView, tabOfView, viewForTab, viewOrder, visibleTabs }
  from '../src/features/navigation/appTabs.mjs';

const allShown = {control:true,calendar:true,notes:true};
const topIds = tabs => tabs.map(tab => tab.id);

test('one registry defines the tabs; planner and control live under one time-management tab', () => {
  assert.equal(new Set(APP_TABS.map(tab => tab.id)).size,APP_TABS.length);
  assert.deepEqual(HIDEABLE_VIEW_IDS,['control','notes','calendar']);
  const tabs = visibleTabs(allShown,{discord:false});
  assert.deepEqual(topIds(tabs),['today','time','learning','notes','calendar']);
  assert.deepEqual(tabs.find(tab => tab.id === 'time').views.map(view => view.id),['planner','control']);
  assert.deepEqual(viewOrder(tabs),['today','planner','control','learning','notes','calendar']);
  assert.equal(tabOfView(tabs,'control').id,'time');
  // 디스코드 연동 탭은 연동했을 때만
  assert.deepEqual(topIds(visibleTabs(allShown,{discord:true})),['today','time','learning','notes','calendar','checkin']);
  assert.deepEqual(availableViews({discord:false}).map(view => view.id),['today','planner','control','learning','notes','calendar']);
  assert.ok(availableViews({discord:true}).some(view => view.id === 'checkin'));
  assert.deepEqual(availableViews({}).filter(view => view.eager).map(view => view.id),['today']);
});

test('only optional views are hidden, preserving navigation order and the default visible views', () => {
  assert.deepEqual(readTabVisibility(null),allShown);
  assert.deepEqual(readTabVisibility('invalid'),allShown);
  assert.deepEqual(readTabVisibility('{"notes":false}'),{control:true,calendar:true,notes:false});
  const order = visibility => viewOrder(visibleTabs(visibility,{}));
  assert.deepEqual(order({control:false,notes:false}),['today','planner','learning','calendar']);
  assert.deepEqual(order({control:false,notes:true}),['today','planner','learning','notes','calendar']);
  assert.deepEqual(order({control:true,calendar:false,notes:true}),['today','planner','control','learning','notes']);
  // 통제를 숨겨도 시간 관리 탭은 남고 하위 화면은 기록 하나뿐
  const noControl = visibleTabs({control:false},{});
  assert.deepEqual(noControl.find(tab => tab.id === 'time').views.map(view => view.id),['planner']);
});

test('navigation moves through sub-views, remembers the last one per tab, and falls back when hidden', () => {
  const tabs = visibleTabs(allShown,{});
  assert.equal(stepView(tabs,'planner',1),'control');
  assert.equal(stepView(tabs,'control',1),'learning');
  assert.equal(stepView(tabs,'learning',-1),'control');
  assert.equal(stepView(tabs,'today',-1),'calendar');
  assert.equal(stepView(tabs,'calendar',1),'today');
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

test('tab choices survive reopening, remain account-specific, and notify mounted navigation', () => {
  const storage = new Map(), events = [];
  const context = vm.createContext({readTabVisibility,HIDEABLE_VIEW_IDS,Event,
    window:{localStorage:{getItem:key => storage.get(key) ?? null,setItem:(key,value) => storage.set(key,value)},dispatchEvent:event => events.push(event.type)},
    useSyncExternalStore:(_subscribe,read) => read(),useMemo:create => create()});
  const source = fs.readFileSync('src/features/navigation/useTabVisibility.js','utf8')
    .replace(/import[^;]+;/g,'').replace('export function','function');
  vm.runInContext(source + '\nglobalThis.hook = useTabVisibility;',context);
  let [value,set] = context.hook('alice');
  assert.equal(value.notes,true);set('notes',false);set('control',false);set('calendar',false);
  assert.equal(context.hook('alice')[0].notes,false);
  assert.equal(context.hook('alice')[0].control,false);
  assert.equal(context.hook('alice')[0].calendar,false);
  assert.equal(context.hook('bob')[0].notes,true);
  assert.equal(context.hook('bob')[0].calendar,true);
  assert.throws(() => set('planner',false));
  assert.deepEqual(events,['planer:tab-visibility','planer:tab-visibility','planer:tab-visibility']);
});
