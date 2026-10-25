import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {studyGap,gapClock} from '../src/features/planner/studyGap.mjs';
import {plannerDate,clockLabel,timerSegments} from '../src/features/planner/scheduleTime.mjs';
import {excludeStudyTime} from '../src/features/planner/controlTime.mjs';
import {controlColor,orderControlActivities} from '../src/features/planner/controlColors.mjs';

const ts = (day,hour,minute = 0) => new Date(2026,9,day,hour,minute).getTime();
const row = (startMin,endMin,kind = 'study',date = '2026-10-22') => ({date,startMin,endMin,kind});

test('first study of the planner day does not offer a gap, even with control or other-day records', () => {
  assert.equal(studyGap([],ts(22,12)),null);
  assert.equal(studyGap([row(0,60,'control'),row(0,60,'study','2026-10-21')],ts(22,12)),null);
  assert.equal(studyGap([row(300,360)],ts(22,12)),null);
});

test('latest preceding study is used and existing control time is subtracted', () => {
  const gap = studyGap([row(0,60),row(80,120),row(130,150,'control')],ts(22,11));
  assert.deepEqual(gap.segments,[row(120,130),row(150,180)].map(({kind,...segment}) => segment));
  assert.equal(studyGap([row(0,180)],ts(22,11)),null);
  assert.equal(studyGap([row(0,60),row(60,180,'control')],ts(22,11)),null);
  const legacy = studyGap([{date:'2026-10-22',startSlot:0,endSlot:4}],ts(22,10));
  assert.equal(legacy.segments[0].startMin,60);
});

test('midnight stays in the same planner day while 05:00 resets first-record behavior', () => {
  const gap = studyGap([row(900,960)],ts(23,1));
  assert.equal(gap.date,'2026-10-22');
  assert.deepEqual(gap.segments,[{date:'2026-10-22',startMin:960,endMin:1020}]);
  assert.equal(gapClock(gap.date,1020),'01:00');
  assert.equal(studyGap([row(900,960)],ts(23,5)),null);
});

test('gap preference defaults off, persists per account and does not change popup settings', () => {
  const storage = new Map();
  const context = vm.createContext({Event,window:{localStorage:{getItem:key=>storage.get(key) ?? null,
    setItem:(key,value)=>storage.set(key,value)},dispatchEvent(){}},useSyncExternalStore:(_subscribe,read)=>read()});
  vm.runInContext(fs.readFileSync('src/features/planner/timerPreferences.js','utf8')
    .replace(/import[^;]+;/g,'').replace(/export function/g,'function')
    + '\nglobalThis.gap = useStudyGapPreference; globalThis.popup = useTimerPopupPreference;globalThis.position = useTimerPopupPosition;',context);
  assert.equal(context.gap('alice')[0],false);
  context.gap('alice')[1](true);
  assert.equal(context.gap('alice')[0],true);
  assert.equal(context.gap('bob')[0],false);
  assert.equal(context.popup('alice')[0],true);
  assert.equal(context.position('alice')[0],'right');
  context.position('alice')[1]('left');
  assert.equal(context.position('alice')[0],'left');
  assert.equal(context.position('bob')[0],'right');
  assert.throws(()=>context.position('alice')[1]('top'));
  context.gap('alice')[1](false);
  assert.equal(context.gap('alice')[0],false);
});

function timerHarness(enabled,prepare,control = false) {
  const source = fs.readFileSync('src/components/planner/TimerBlock.jsx','utf8');
  const body = source.slice(source.indexOf('function TimerBlock('),source.indexOf('\n  return (',source.indexOf('function TimerBlock(')));
  const slots = [], writes = [];
  let cursor = 0, now = ts(22,12);
  class Clock extends Date {static now(){return now;}}
  const context = vm.createContext({Date:Clock,clockLabel,timerSegments,controlColor,COLORS:['#6366f1'],CUSTOM_ID:'__custom__',activeTimerOwner:null,
    useTimerPopupPreference:()=>[false],useTimerPopupPosition:()=>['right'],useStudyGapPreference:()=>[enabled],prepareStudyGap:prepare,
    useState(initial){const index = cursor++;if (!(index in slots)) slots[index] = initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
    useRef(initial){const index = cursor++;return slots[index] ??= {current:initial};},useMemo:fn=>fn(),useEffect:()=>{},
  });
  vm.runInContext(body + '\nreturn {actId,setActId,handleStart,handleStop,continueStart,running,starting,gap};}\nglobalThis.render = TimerBlock;',context);
  const activity = {id:'a',name:'독서',color:'#6366f1'};
  const secondActivity = {id:'b',name:'운동',color:'#ef4444',group:'controlled'};
  const render = () => {cursor=0;return context.render({uid:'alice',activities:[activity,secondActivity],allActivities:[activity,secondActivity],control,onSaveTimer:async data=>writes.push(data)});};
  render().setActId('a');
  return {render,writes,advance:minutes=>{now += minutes * 60000;}};
}

const flush = () => new Promise(resolve=>setImmediate(resolve));
test('activity quick start selects and records the clicked activity without replacing a running timer',async () => {
  for (const control of [false,true]) {
    const harness = timerHarness(false,async()=>null,control);
    const beforeRender = harness.render();
    beforeRender.handleStart('b');
    beforeRender.handleStart('a');
    assert.equal(harness.render().running,true);
    assert.equal(harness.render().actId,'b');
    harness.advance(5);
    await harness.render().handleStop();
    assert.equal(harness.writes.length,1);
    assert.equal(harness.writes[0].metadata.activityId,'b');
    assert.equal(harness.writes[0].metadata.activityName,'운동');
    assert.equal(harness.writes[0].metadata.activityColor,'#ef4444');
    if (control) assert.equal(harness.writes[0].metadata.group,'controlled');
  }
});

test('activity quick start retains its activity and click time through the study gap flow',async () => {
  const harness = timerHarness(true,async()=>studyGap([row(0,60)],ts(22,12)));
  harness.render().handleStart('b');
  await flush();
  assert.equal(harness.render().starting,true);
  assert.equal(harness.render().actId,'b');
  harness.advance(1);
  harness.render().continueStart();
  harness.advance(4);
  await harness.render().handleStop();
  assert.equal(harness.writes[0].metadata.activityId,'b');
  assert.equal(harness.writes[0].startTs,ts(22,12));
});
test('disabled option and control timer bypass gap checks; first-record null result starts normally',async () => {
  for (const control of [false,true]) {
    let reads = 0;
    const harness = timerHarness(control,async()=>{reads++;},control);
    harness.render().handleStart();
    assert.equal(harness.render().running,true);
    assert.equal(reads,0);
  }
  const first = timerHarness(true,async()=>null);
  first.render().handleStart();await flush();
  assert.equal(first.render().running,true);
  assert.equal(first.render().gap,null);
});

test('gap dialog and fetch failures can be skipped, prevent double starts and retain click time',async () => {
  for (const fail of [false,true]) {
    let reads = 0;
    const gap = studyGap([row(0,60)],ts(22,12));
    const harness = timerHarness(true,async()=>{reads++;if(fail) throw Error('offline');return gap;});
    harness.render().handleStart();harness.render().handleStart();await flush();
    assert.equal(reads,1);
    assert.equal(harness.render().starting,true);
    assert.equal(!!harness.render().gap,true);
    harness.advance(2);harness.render().continueStart();
    assert.equal(harness.render().running,true);
    harness.advance(8);await harness.render().handleStop();
    assert.equal(harness.writes[0].startTs,ts(22,12));
    assert.equal(harness.writes[0].segments[0].endMin - harness.writes[0].segments[0].startMin,10);
  }
});

test('gap service queries actual day with owner, excludes new entries and retries without duplicates',async () => {
  const queries = [], writes = [];
  let rows = [row(0,60)];
  const snapshot = values => ({docs:values.map((data,index)=>({id:String(index),data:()=>data}))});
  const context = vm.createContext({db:{},studyGap,plannerDate,excludeStudyTime,controlColor,orderControlActivities,
    collection:(_db,name)=>name,where:(field,op,value)=>({field,op,value}),query:(name,...filters)=>({name,filters}),
    getDocs:async request=>{queries.push(request);return snapshot(request.name==='scheduleBlocks'?rows:[{name:'휴식',group:'controlled'}]);},
    doc:(_db,name,id)=>({name,id}),serverTimestamp:()=>0,
    writeBatch:()=>({set:(ref,data)=>writes.push({ref,data}),commit:async()=>{rows.push(...writes.map(write=>write.data));}}),
  });
  vm.runInContext(fs.readFileSync('src/features/planner/studyGapService.js','utf8')
    .replace(/import[\s\S]*?from\s*['"][^'"]+['"];?/g,'').replace(/export /g,'')
    + '\nglobalThis.prepare = prepareStudyGap; globalThis.save = saveStudyGap;',context);
  const gap = await context.prepare('alice',ts(22,12));
  rows.push(row(90,120,'control'));
  await context.save('alice',gap,{activityId:'rest',activityName:'휴식',group:'controlled'});
  assert.equal(writes.length,2);
  assert.deepEqual(writes.map(write=>[write.data.startMin,write.data.endMin]),[[60,90],[120,240]]);
  assert.ok(writes.every(write=>write.data.kind==='control' && write.data.uid==='alice'));
  await context.save('alice',gap,{activityId:'rest',activityName:'휴식',group:'controlled'});
  assert.equal(writes.length,2);
  for (const request of queries) assert.ok(request.filters.some(filter=>filter.field==='uid' && filter.value==='alice'));
  for (const request of queries.filter(item=>item.name==='scheduleBlocks')) assert.ok(request.filters.some(filter=>filter.field==='date' && filter.value==='2026-10-22'));
});
