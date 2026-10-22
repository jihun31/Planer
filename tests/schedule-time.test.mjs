import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { rangeForDate, visibleHours, blockMinutes, timerSegments, plannerDate, clockLabel, validRange, shiftPlannerDate } from '../src/features/planner/scheduleTime.mjs';
import { oppositeDisplayFromHistory, validDisplayMode } from '../src/features/planner/oppositeDisplay.mjs';
const ts = (d,h,m=0,s=0) => new Date(2026,9,d,h,m,s).getTime();

test('opposite tab display modes are independent and old settings keep defaults', () => {
  assert.deepEqual(oppositeDisplayFromHistory([]), {
    plannerOppositeDisplay: 'faded', controlOppositeDisplay: 'blind',
  });
  const history = [
    { changedAt: 1, startHour: 8, endHour: 3 },
    { changedAt: 2, plannerOppositeDisplay: 'all', controlOppositeDisplay: 'transparent' },
    { changedAt: 3, plannerOppositeDisplay: 'blind', controlOppositeDisplay: 'invalid' },
  ];
  assert.deepEqual(oppositeDisplayFromHistory(history), {
    plannerOppositeDisplay: 'blind', controlOppositeDisplay: 'faded',
  });
  assert.equal(validDisplayMode('all'), true);
  assert.equal(validDisplayMode('hidden'), true);
  assert.equal(validDisplayMode('transparent'), false);
  assert.equal(validDisplayMode('unknown'), false);
});
test('versioned ranges keep previous days, handle repeated changes and overnight/24-hour ranges', () => {
  const history = [{effectiveDate:'2026-10-05',changedAt:1,startHour:10,endHour:1}, {effectiveDate:'2026-10-07',changedAt:2,startHour:7,endHour:22}, {effectiveDate:'2026-10-05',changedAt:3,startHour:9,endHour:2}];
  assert.equal(rangeForDate(history,'2026-10-04').startHour,8);
  assert.equal(rangeForDate(history,'2026-10-06').startHour,9);
  assert.equal(rangeForDate(history,'2026-10-08').startHour,7);
  assert.deepEqual(visibleHours({startHour:10,endHour:1},[]),Array.from({length:15},(_,i)=>10+i));
  assert.equal(visibleHours({startHour:0,endHour:0},[]).length,24);
  assert.equal(visibleHours({startHour:8,endHour:17},[]).length,9);
  assert.equal(validRange({startHour:24,endHour:1}),false);
  assert.equal(validRange({startHour:8.5,endHour:1}),false);
});
test('keyboard day navigation crosses month, year, and leap-day boundaries', () => {
  assert.equal(shiftPlannerDate('2026-10-01',-1),'2026-09-30');
  assert.equal(shiftPlannerDate('2026-12-31',1),'2027-01-01');
  assert.equal(shiftPlannerDate('2028-02-28',1),'2028-02-29');
  assert.equal(shiftPlannerDate('2028-02-29',1),'2028-03-01');
});
test('narrowing the range keeps early/late legacy and new records at their original clock times', () => {
  const blocks = [{startMin:0,endMin:10},{startSlot:72,endSlot:76},{startHour:7,endHour:8}];
  const before=JSON.stringify(blocks);
  const hours=visibleHours({startHour:10,endHour:1},blocks);
  assert.equal(hours[0],7); assert.equal(hours.at(-1),26);
  assert.equal(blockMinutes(blocks[0]).startMin,0);
  assert.equal(blockMinutes(blocks[1]).endMin,1140);
  assert.equal(JSON.stringify(blocks),before);
});
test('timer is not clamped to grid and respects actual day, 05:00 boundary, month and year transitions', () => {
  assert.deepEqual(timerSegments(ts(5,6),ts(5,6,12)),[{date:'2026-10-05',startMin:-120,endMin:-108}]);
  assert.deepEqual(timerSegments(ts(5,3),ts(5,3,12)),[{date:'2026-10-04',startMin:1140,endMin:1152}]);
  const parts=timerSegments(ts(5,4,50),ts(5,5,10));
  assert.deepEqual(parts.map(b=>b.date),['2026-10-04','2026-10-05']);
  assert.equal(parts.reduce((n,b)=>n+b.endMin-b.startMin,0),20);
  assert.equal(plannerDate(ts(5,4,59)),'2026-10-04');
  assert.equal(plannerDate(ts(5,5)),'2026-10-05');
  assert.deepEqual(timerSegments(new Date(2026,0,1,4,55).getTime(),new Date(2026,0,1,5,5).getTime()).map(b=>b.date),['2025-12-31','2026-01-01']);
});
test('real TimerBlock ignores past/future calendar selection, snapshots metadata, stops once and retries unchanged data', async () => {
  const source=fs.readFileSync('src/components/planner/TimerBlock.jsx','utf8');
  const body=source.slice(source.indexOf('function TimerBlock('),source.indexOf('\n  return (',source.indexOf('function TimerBlock(')));
  const slots=[];let cursor=0, now=ts(5,12),fail=true;const calls=[];
  class Clock extends Date { static now(){ return now; } }
  const context=vm.createContext({Date:Clock,clockLabel,timerSegments,COLORS:['#123456'],CUSTOM_ID:'__custom__',activeTimerOwner:null,
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>slots[i]=v];},
    useRef(initial){const i=cursor++;return slots[i]??=( {current:initial} );},
    useMemo:fn=>fn(),useEffect:()=>{},
  });
  vm.runInContext(body+'\n return {setActId,handleStart,handleStop,savePending,saveError};}\nglobalThis.render=TimerBlock;',context);
  let props={activities:[{id:'a',name:'독서',color:'#123456'}],allActivities:[{id:'a',name:'독서',color:'#123456'}],selectedDate:'2020-01-01',onSaveTimer:async data=>{calls.push(JSON.parse(JSON.stringify(data)));if(fail)throw Error('offline');}};
  const render=()=>{cursor=0;return context.render(props);};
  render().setActId('a');render().handleStart();
  props={...props,selectedDate:'2030-01-01',allActivities:[]};now=ts(5,12,12);
  const running=render();await Promise.all([running.handleStop(),running.handleStop()]);
  assert.equal(calls.length,1);assert.equal(calls[0].segments[0].date,'2026-10-05');
  assert.equal(calls[0].segments[0].endMin-calls[0].segments[0].startMin,12);
  assert.equal(calls[0].metadata.activityName,'독서');
  assert.ok(render().saveError);fail=false;now=ts(5,13);await render().savePending();
  assert.deepEqual(calls[1],calls[0]);assert.equal(render().saveError,'');
});
test('desktop timer waits for popup confirmation and reports connection failure', async () => {
  const source = fs.readFileSync('src/components/planner/TimerBlock.jsx', 'utf8');
  const body = source.slice(source.indexOf('function TimerBlock('), source.indexOf('\n  return (', source.indexOf('function TimerBlock(')));
  const slots = []; let cursor = 0, reply;
  const api = { startTimerPopup: () => reply, closeTimerPopup() {}, onTimerStopped: () => () => {} };
  const context = vm.createContext({ Date, clockLabel, timerSegments, COLORS: ['#123456'], CUSTOM_ID: '__custom__', activeTimerOwner: null,
    window: { electronAPI: api },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => slots[i] = value]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo: fn => fn(), useEffect: () => {},
  });
  vm.runInContext(body + '\n return {setActId,handleStart,electronPopupOpen,desktopError};}\nglobalThis.render=TimerBlock;', context);
  const props = { activities: [{ id: 'a', name: 'Study', color: '#123456' }], allActivities: [{ id: 'a', name: 'Study', color: '#123456' }], onSaveTimer: async () => {} };
  const render = () => { cursor = 0; return context.render(props); };
  render().setActId('a');
  reply = Promise.resolve({ ok: true });
  render().handleStart();
  assert.equal(render().electronPopupOpen, false);
  await reply;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(render().electronPopupOpen, true);
  slots.length = 0;
  context.activeTimerOwner = null;
  render().setActId('a');
  reply = Promise.resolve({ ok: false });
  render().handleStart();
  await reply;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(render().electronPopupOpen, false);
  assert.match(render().desktopError, /앱을 다시 시작/);
});
test('direct-entry timer stores the learning choice with its saved segments', async () => {
  const source = fs.readFileSync('src/components/planner/TimerBlock.jsx','utf8');
  const body = source.slice(source.indexOf('function TimerBlock('),source.indexOf('\n  return (',source.indexOf('function TimerBlock(')));
  const slots = []; let cursor = 0, saved;
  const context = vm.createContext({Date,clockLabel,timerSegments,COLORS:['#123456'],CUSTOM_ID:'__custom__',activeTimerOwner:null,
    useState(initial) { const i=cursor++; if (!(i in slots)) slots[i]=initial; return [slots[i],value=>slots[i]=value]; },
    useRef(initial) { const i=cursor++; return slots[i]??={current:initial}; },
    useMemo:fn=>fn(),useEffect:()=>{},
  });
  vm.runInContext(body+'\n return {setActId,setCustomName,setCustomLearning,handleStart,handleStop};}\nglobalThis.render=TimerBlock;',context);
  const props = {activities:[],allActivities:[],onSaveTimer:async data=>{saved=data;}};
  const render = () => {cursor=0;return context.render(props);};
  render().setActId('__custom__');
  render().setCustomName('독서');
  render().setCustomLearning(true);
  render().handleStart();
  await render().handleStop();
  assert.equal(saved.metadata.learningIncluded,true);
  assert.equal(saved.metadata.customName,'독서');
});
test('timer multi-day writes commit atomically with stable IDs on retry', async () => {
  const source=fs.readFileSync('src/features/planner/plannerService.js','utf8').replace(/import[\s\S]*?from\s*["'][^"']+["'];/g,'').replace(/export const /g,'const ');
  const batches=[];
  const context=vm.createContext({db:{},doc:(_db,col,id)=>({col,id}),serverTimestamp:()=>0,writeBatch:()=>{const writes=[];return {set:(ref,data)=>writes.push({ref,data}),commit:async()=>batches.push(writes)};}});
  vm.runInContext(source+'\nglobalThis.save=saveTimer;',context);
  const data={startTs:ts(5,4,50),segments:timerSegments(ts(5,4,50),ts(5,5,10)),metadata:{activityId:'a'}};
  await context.save('alice',data);await context.save('alice',data);
  assert.equal(batches.length,2);assert.equal(batches[0].length,2);
  assert.deepEqual(batches[0],batches[1]);assert.equal(batches[0][0].data.uid,'alice');
});
