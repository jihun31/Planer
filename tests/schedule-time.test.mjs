import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { rangeForDate, visibleHours, blockMinutes, timerSegments, plannerDate, clockLabel, validRange, shiftPlannerDate } from '../src/features/planner/scheduleTime.mjs';
import { oppositeDisplayFromHistory, validDisplayMode } from '../src/features/planner/oppositeDisplay.mjs';
import { summarizeBlocks } from '../src/features/planner/activityHistory.mjs';
import { planHintRuns } from '../src/features/plans/plannerPlanHints.mjs';
import { scheduleRunCells } from '../src/features/planner/scheduleRuns.mjs';
const ts = (d,h,m=0,s=0) => new Date(2026,9,d,h,m,s).getTime();

function scheduleHarness(overrides = {}) {
  const source = fs.readFileSync('src/components/planner/DailySchedule.jsx', 'utf8');
  const body = source.slice(source.indexOf('function DailySchedule('), source.indexOf('\n  return ('));
  const slots = [], effects = [], saved = [];
  let cursor = 0;
  const recordActivityRef = { current: null };
  const props = {
    date: '2026-10-23', range: { startHour: 8, endHour: 3 }, blocks: [], oppositeBlocks: [],
    oppositeActivities: [], oppositeMode: 'hidden',
    activities: [{ id: 'a', name: '독서', color: '#123456' }, { id: 'b', name: '운동', color: '#654321' }],
    allActivities: [], recordActivityRef,
    onAddBlock: async data => saved.push(JSON.parse(JSON.stringify(data))), ...overrides,
  };
  const context = vm.createContext({
    visibleHours, getBlockMins: blockMinutes, summarizeBlocks, planHintRuns, scheduleRunCells, NO_PLANS:[], COLORS: ['#123456'], CUSTOM_ID: '__custom__',
    window: { addEventListener() {}, removeEventListener() {} },
    controlColor: () => '#abcdef',
    useMemo: fn => fn(), useEffect: fn => effects.push(fn),
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = value; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
  });
  vm.runInContext(body + '\n return {handleCellClick, handleAdd, clearAll, setActId, setCustomName, setCustomGroup, setCustomLearning, selMin, selMax, pending, saveError};}\nglobalThis.render=DailySchedule;', context);
  const render = () => {
    cursor = 0; effects.length = 0;
    const result = context.render(props);
    effects.forEach(effect => effect());
    return result;
  };
  const select = (start, end) => { render().handleCellClick(start); render().handleCellClick(end); render(); };
  render();
  return { render, select, props, saved, recordActivityRef };
}

const finishScheduleSave = () => new Promise(resolve => setImmediate(resolve));

test('adjacent activity records share one display run without changing stored records',()=>{
  const activities={stocks:{name:'주식',color:'#f97316'},other:{name:'주식',color:'#f97316'}};
  const blocks=[{id:'first',activityId:'stocks',startMin:45,endMin:60},{id:'second',activityId:'stocks',startMin:60,endMin:75}];
  const original=JSON.stringify(blocks),minutes={};
  for(const block of blocks)for(let minute=block.startMin;minute<block.endMin;minute++)minutes[minute]=block;
  const runs=scheduleRunCells(minutes,activities,{});
  assert.equal(runs.get(45),runs.get(74));
  assert.equal(runs.get(45).startMin,45);assert.equal(runs.get(45).endMin,75);
  assert.equal(JSON.stringify(blocks),original);
  delete minutes[60];
  const gapped=scheduleRunCells(minutes,activities,{});
  assert.notEqual(gapped.get(59),gapped.get(61));
  minutes[60]={...blocks[1],activityId:'other'};
  const separated=scheduleRunCells(minutes,activities,{});
  assert.notEqual(separated.get(59),separated.get(60));
  assert.notEqual(separated.get(60),separated.get(61));
});

test('custom activity runs respect color, control group and opposite-tab boundaries',()=>{
  const first={customName:'휴식',customColor:'#123456',group:'controlled'};
  for(const patch of [{},{customColor:'#654321'},{customName:'다른 활동'},{group:'foolish'},{_opposite:true}]){
    const runs=scheduleRunCells({0:first,1:{...first,...patch}},{},{});
    assert.equal(runs.get(0)===runs.get(1),Object.keys(patch).length===0);
  }
});

test('display-only plans allow normal recording and stale loading disables writes without clearing selection',async()=>{
  const h=scheduleHarness({plans:[{title:'계획',startMin:0,endMin:10}]});
  h.select(0,9);h.props.disabled=true;h.render();
  assert.equal(h.recordActivityRef.current('a'),true);
  await finishScheduleSave();assert.equal(h.saved.length,0);assert.equal(h.render().selMin,0);
  h.render().handleCellClick(20);assert.equal(h.render().selMin,0);
  h.props.disabled=false;h.render();h.recordActivityRef.current('a');await finishScheduleSave();
  assert.deepEqual(h.saved,[{date:'2026-10-23',startMin:0,endMin:10,activityId:'a'}]);
});

for (const control of [false, true]) {
  test(`activity clicks save the selected range immediately in ${control ? 'control' : 'planner'}`, async () => {
    const h = scheduleHarness({ control });
    assert.equal(h.recordActivityRef.current('b'), false, 'no selection leaves the click available for the timer');
    h.render().setActId('a');
    h.select(1029, 1020);
    assert.equal(h.recordActivityRef.current('b'), true);
    await finishScheduleSave();
    assert.deepEqual(h.saved, [{ date: '2026-10-23', startMin: 1020, endMin: 1030, activityId: 'b' }]);
    assert.equal(h.render().selMin, null);
    assert.equal(h.recordActivityRef.current('a'), false);
    h.render().handleCellClick(0); h.render();
    assert.equal(h.recordActivityRef.current('a'), true);
    await finishScheduleSave();
    assert.deepEqual(h.saved[1], { date: '2026-10-23', startMin: 0, endMin: 1, activityId: 'a' });
  });
}

test('quick recording prevents duplicate writes and preserves the selection for retry after failure', async () => {
  let rejectSave;
  const calls = [];
  const h = scheduleHarness({ onAddBlock: data => {
    calls.push(JSON.parse(JSON.stringify(data)));
    return new Promise((resolve, reject) => { rejectSave = reject; });
  } });
  h.select(0, 9);
  h.recordActivityRef.current('a');
  h.recordActivityRef.current('b');
  h.render().handleCellClick(20);
  h.render().clearAll();
  assert.equal(calls.length, 1);
  rejectSave(new Error('offline'));
  await finishScheduleSave();
  assert.ok(h.render().saveError);
  assert.equal(h.render().selMin, 0);
  assert.equal(h.render().selMax, 9);
  h.props.onAddBlock = async data => calls.push(JSON.parse(JSON.stringify(data)));
  h.render(); h.recordActivityRef.current('a');
  await finishScheduleSave();
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(h.render().saveError, '');
  assert.equal(h.render().selMin, null);
});

test('quick recording keeps overlap restrictions for each tab, including hidden study blocks', async () => {
  const block = { id: 'existing', date: '2026-10-23', startMin: 4, endMin: 6 };
  for (const [control, ownBlock] of [[false, true], [true, false], [false, false]]) {
    const h = scheduleHarness({ control, blocks: ownBlock ? [block] : [], oppositeBlocks: ownBlock ? [] : [block] });
    h.select(0, 9); h.recordActivityRef.current('a');
    await finishScheduleSave();
    const allowed = !control && !ownBlock;
    assert.equal(h.saved.length, allowed ? 1 : 0);
    assert.equal(Boolean(h.render().saveError), !allowed);
  }
});

test('the manual record form still saves custom activities and learning choices', async () => {
  for (const control of [false, true]) {
    const h = scheduleHarness({ control });
    h.select(-60, -31);
    h.render().setActId('__custom__'); h.render().setCustomName(' 휴식 ');
    h.render().setCustomGroup('controlled'); h.render().setCustomLearning(true);
    await h.render().handleAdd({ preventDefault() {} });
    assert.deepEqual(h.saved[0], {
      date: '2026-10-23', startMin: -60, endMin: -30, activityId: null, customName: '휴식',
      customColor: control ? '#abcdef' : '#123456', ...(control ? { group: 'controlled' } : { learningIncluded: true }),
    });
  }
});

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
    useTimerPopupPreference:()=>[false],useStudyGapPreference:()=>[false],useTimerPopupPosition:()=>['right'],
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
  const slots = []; let cursor = 0, reply, popupData;
  const api = { startTimerPopup: data => {popupData=data;return reply;}, closeTimerPopup() {}, onTimerStopped: () => () => {} };
  const context = vm.createContext({ Date, clockLabel, timerSegments, COLORS: ['#123456'], CUSTOM_ID: '__custom__', activeTimerOwner: null,
    useTimerPopupPreference:()=>[true],useStudyGapPreference:()=>[false],useTimerPopupPosition:()=>['left'],
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
  assert.equal(popupData.position,'left');
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
    useTimerPopupPreference:()=>[false],useStudyGapPreference:()=>[false],useTimerPopupPosition:()=>['right'],
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
