import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readTabVisibility, visibleAppTabs } from '../src/features/navigation/tabVisibility.mjs';

test('only optional tabs are hidden, preserving navigation order and the default visible tabs', () => {
  const tabs = ['today','planner','control','learning','notes','calendar'].map(id => ({id}));
  assert.deepEqual(readTabVisibility(null),{control:true,calendar:true,notes:true});
  assert.deepEqual(readTabVisibility('invalid'),{control:true,calendar:true,notes:true});
  assert.deepEqual(visibleAppTabs(tabs,{control:false,notes:false}).map(tab => tab.id),['today','planner','learning','calendar']);
  assert.deepEqual(visibleAppTabs(tabs,{control:false,notes:true}).map(tab => tab.id),['today','planner','learning','notes','calendar']);
  assert.deepEqual(visibleAppTabs(tabs,{control:true,notes:true}).map(tab => tab.id),['today','planner','control','learning','notes','calendar']);
  assert.deepEqual(visibleAppTabs(tabs,{control:true,calendar:false,notes:true}).map(tab => tab.id),['today','planner','control','learning','notes']);
});

test('tab choices survive reopening, remain account-specific, and notify mounted navigation', () => {
  const storage = new Map(), events = [];
  const context = vm.createContext({readTabVisibility,Event,
    window:{localStorage:{getItem:key => storage.get(key) ?? null,setItem:(key,value) => storage.set(key,value)},dispatchEvent:event => events.push(event.type)},
    useSyncExternalStore:(_subscribe,read) => read()});
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
  assert.deepEqual(events,['planer:tab-visibility','planer:tab-visibility','planer:tab-visibility']);
});
