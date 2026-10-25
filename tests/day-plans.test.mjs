import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { entryInput, minuteFromTime, overrideId, overlappingPlanKeys, planDateWindow, planInput, plansForDate, routineCatalog, routineInput, shiftPlanDate } from '../src/features/plans/planModel.mjs';
import {planHours,planActivity} from '../src/features/plans/planTimetable.mjs';
import {rangeForDate} from '../src/features/planner/scheduleTime.mjs';
import {projectPlannerPlans,planHintRuns} from '../src/features/plans/plannerPlanHints.mjs';

const routine=(patch={})=>({routineId:'english',title:'영어',startMinute:540,endMinute:600,weekdays:[1,3,5],effectiveDate:'2026-10-19',revision:1,deleted:false,...patch});

test('planner hints resolve one opened day, enforce registration date and do not materialize future plans',()=>{
  const createdAt={toMillis:()=>new Date(2026,9,24,12).getTime()};
  const versions=[routine({weekdays:[0,1,2,3,4,5,6],createdAt})],entries=[];
  assert.equal(projectPlannerPlans(versions,entries,'2026-10-23').length,0,'Backdated effective dates must not precede registration');
  const today=projectPlannerPlans(versions,entries,'2026-10-24');
  assert.equal(today.length,1);assert.equal(today[0].startMin,60);assert.equal(today[0].endMin,120);
  assert.equal(projectPlannerPlans(versions,entries,'2099-01-01').length,1);
  assert.equal(versions.length,1);assert.equal(entries.length,0);
  const override={id:'override',date:'2026-10-24',routineId:'english',title:'하루 변경',startMinute:660,endMinute:720};
  assert.equal(projectPlannerPlans(versions,[override],override.date)[0].title,'하루 변경');
  assert.equal(projectPlannerPlans(versions,[{...override,skipped:true}],override.date).length,0);
  assert.equal(projectPlannerPlans(versions,[override],'2026-10-25')[0].title,'영어');
});

test('different activities remove the entire plan hint, while matching records keep only its outline',()=>{
  const plans=[{title:'공부 계획',activityId:'study',startMin:60,endMin:180}],records=[{activityId:'study',startMin:80,endMin:100},{activityId:'study',startMin:130,endMin:180}];
  const before=JSON.stringify(records);
  assert.deepEqual(planHintRuns(plans,records),[
    {startMin:60,endMin:120,title:'공부 계획',color:'#6366f1',showLabel:false}, {startMin:120,endMin:180,title:'공부 계획',color:'#6366f1',showLabel:false},
  ]);
  assert.equal(JSON.stringify(records),before);
  assert.equal(planHintRuns(plans,[{activityId:'study',startMin:60,endMin:180}]).length,2);
  assert.deepEqual(planHintRuns(plans,[{activityId:'stocks',startMin:60,endMin:75}]),[],'A short different activity must also remove the outline in the next hour');
  assert.deepEqual(planHintRuns(plans,[...records,{activityId:'stocks',startMin:100,endMin:101}]),[]);
  assert.deepEqual(planHintRuns(plans,[{activityId:'other',activityName:'공부 계획',startMin:80,endMin:100}]),[],'Duplicate names must not match different registered activities');
  assert.deepEqual(planHintRuns(plans,[{activityId:'study',_opposite:true,startMin:80,endMin:100}]),[],'Other-tab activities are distinct');
  assert.equal(planHintRuns(plans,[{activityId:'other',startMin:180,endMin:190}]).length,2,'Touching endpoints do not overlap');
  assert.equal(planHintRuns(plans,[])[0].showLabel,true,'Removing a conflicting record restores the plan');
  assert.equal(planHintRuns([{title:'직접 입력',startMin:0,endMin:10}],[{customName:'직접 입력',startMin:0,endMin:5}])[0].showLabel,false);
  assert.deepEqual(planHintRuns([{title:'한 분',startMin:0,endMin:1}],[]),[{startMin:0,endMin:1,title:'한 분',color:'#6366f1',showLabel:true}]);
  assert.deepEqual(planHintRuns([{title:'18:30~19:30',startMin:630,endMin:690}],[]).map(run=>[run.startMin,run.endMin]),[[630,660],[660,690]]);
  assert.equal(planHintRuns([{title:'활동 색',color:'#22c55e',startMin:0,endMin:10}],[])[0].color,'#22c55e');
  assert.equal(planHintRuns([{title:'새벽',startMin:1080,endMin:1140}],[])[0].startMin,1080);
});

test('retaining a selected timetable across a month load never retains another account or date',()=>{
  const reference={current:null},context=vm.createContext({useRef:()=>reference});
  const source=fs.readFileSync('src/features/planner/useRetainedPlannerDay.js','utf8').replace(/import[^;]+;/,'').replace('export function','function');
  vm.runInContext(source+'\nglobalThis.hook=useRetainedPlannerDay;',context);
  const ready={loading:false,error:null,blocks:[{id:'private',date:'2026-10-24'}],oppositeBlocks:[]},loading={...ready,loading:true,blocks:[]};
  context.hook('alice','2026-10-24',ready);
  assert.equal(context.hook('alice','2026-10-24',loading).blocks[0].id,'private');
  assert.equal(context.hook('bob','2026-10-24',loading).blocks.length,0);
  assert.equal(context.hook('alice','2026-10-25',loading).blocks.length,0);
  assert.equal(context.hook(null,'2026-10-24',loading).blocks.length,0);
});

test('plan timetable follows dated planner ranges without hiding old plans, while retaining midnight-based storage',()=>{
  const history=[{startHour:8,endHour:3,effectiveDate:'2026-10-20'},{startHour:10,endHour:23,effectiveDate:'2026-10-25'}];
  assert.deepEqual(planHours(rangeForDate(history,'2026-10-24')),Array.from({length:19},(_,i)=>8+i));
  assert.deepEqual(planHours(rangeForDate(history,'2026-10-26'),[routine()]),Array.from({length:14},(_,i)=>9+i));
  const nextDay=entryInput({date:'2026-10-24',title:'새벽',startMinute:1560,endMinute:1590,activityId:'english',activityColor:'#22c55e'});
  assert.equal(nextDay.startMinute,1560);assert.equal(nextDay.activityId,'english');
  assert.equal(planHours({startHour:10,endHour:23},[nextDay]).at(-1),26);
  assert.throws(()=>planInput({...nextDay,startMinute:2880,endMinute:2881}));
  assert.throws(()=>planInput({...nextDay,startMinute:2870,endMinute:2890}));
  assert.throws(()=>planInput({...nextDay,activityId:'../other'}));
  assert.throws(()=>planInput({...nextDay,activityColor:'red'}));
});

test('activity IDs keep duplicate names separate and preserve display after archiving or deleting an activity',()=>{
  const activities=[{id:'a',name:'영어',color:'#22c55e'},{id:'b',name:'영어',color:'#f97316'}];
  const plan={title:'저장한 이름',activityId:'b',activityColor:'#6366f1',startMinute:540,endMinute:600};
  assert.equal(planActivity(plan,activities).color,'#f97316');
  assert.equal(planActivity(plan,[{...activities[1],name:'회화',archived:true}]).title,'회화');
  assert.equal(planActivity(plan,[]).title,'저장한 이름');assert.equal(planActivity(plan,[]).color,'#6366f1');
  assert.equal(planActivity({title:'직접 입력'},activities).title,'직접 입력');
});
test('weekly routines resolve by weekday and day-only changes do not alter the following occurrence',()=>{
  const versions=[routine()];
  assert.equal(plansForDate(versions,[],'2026-10-20').length,0);
  assert.equal(plansForDate(versions,[],'2026-10-21')[0].startMinute,540);
  const entry={...entryInput({title:'영어 보충',startMinute:660,endMinute:720,date:'2026-10-21',routineId:'english'}),id:'exception'};
  assert.equal(plansForDate(versions,[entry],entry.date)[0].startMinute,660);
  assert.equal(plansForDate(versions,[entry],'2026-10-28')[0].startMinute,540);
  entry.skipped=true;assert.equal(plansForDate(versions,[entry],entry.date)[0].skipped,true);
  assert.equal(plansForDate(versions,[],entry.date)[0].skipped,undefined);
});
test('version history preserves old plans, and a later edit can cancel an older scheduled future change',()=>{
  const versions=[routine(),routine({effectiveDate:'2026-11-01',startMinute:720,endMinute:780,revision:2}),
    routine({effectiveDate:'2026-10-24',deleted:true,revision:3})];
  assert.equal(plansForDate(versions,[],'2026-10-23')[0].startMinute,540);
  assert.equal(plansForDate(versions,[],'2026-11-02').length,0);
  versions.push(routine({effectiveDate:'2026-10-26',revision:4,startMinute:600,endMinute:660}));
  assert.equal(plansForDate(versions,[],'2026-10-26')[0].startMinute,600);
  assert.equal(routineCatalog(versions)[0].revision,4);
  const override={id:'exception',routineId:'english',date:'2026-10-26',title:'하루 수정',startMinute:800,endMinute:850,skipped:false};
  assert.equal(plansForDate(versions,[override],override.date)[0].title,'하루 수정');
});
test('single-day entries, skipped routines and overnight overlap warnings remain independent',()=>{
  const versions=[routine({routineId:'sleep',weekdays:[5],startMinute:1380,endMinute:1500})];
  const entries=[{id:'a',routineId:null,date:'2026-10-24',title:'이른 공부',startMinute:30,endMinute:90,skipped:false},
    {id:'b',routineId:null,date:'2026-10-24',title:'다음 공부',startMinute:90,endMinute:120,skipped:false}];
  const overlaps=overlappingPlanKeys(versions,entries,'2026-10-24');
  assert.ok(overlaps.has('entry:a'));assert.ok(!overlaps.has('entry:b'),'Adjacent plans must not be marked overlapping');
  assert.equal(plansForDate(versions,entries,'2026-10-24').length,2);
  assert.equal(plansForDate(versions,entries,'2026-10-25').length,0);
  entries.push({id:'skip',routineId:'sleep',date:'2026-10-23',title:'수면',startMinute:1380,endMinute:1500,skipped:true});
  assert.equal(overlappingPlanKeys(versions,entries,'2026-10-24').size,0);
});
test('invalid dates, empty days, malformed times and oversized plans are rejected before writes',()=>{
  const input={title:' 영어 ',startMinute:540,endMinute:600};
  assert.equal(planInput(input).title,'영어');assert.equal(minuteFromTime('09:30'),570);
  for(const value of ['24:00','9:00','00:60','garbage'])assert.throws(()=>minuteFromTime(value));
  for(const patch of [{title:''},{title:'a'.repeat(121)},{startMinute:-1},{endMinute:540},{endMinute:2000},{startMinute:5.5}])assert.throws(()=>planInput({...input,...patch}));
  assert.throws(()=>routineInput({...input,effectiveDate:'2026-02-30',weekdays:[1]}));
  assert.throws(()=>routineInput({...input,effectiveDate:'2026-10-24',weekdays:[]}));
  assert.throws(()=>entryInput({...input,date:'2026-10-24',routineId:'../private'}));
  assert.throws(()=>entryInput({...input,date:'2026-10-24',skipped:true}));
  assert.equal(shiftPlanDate('2026-12-31',1),'2027-01-01');
  assert.deepEqual(planDateWindow('2024-03-01'),['2024-02-29','2024-03-01','2024-03-02']);
});

test('removing a routine hides its management entry and future overrides while preserving past days and unrelated plans',()=>{
  const versions=[routine(),routine({revision:2,effectiveDate:'2026-10-24',deleted:true,removed:true})];
  const entries=[{id:'past',routineId:'english',date:'2026-10-23',title:'지난 계획',startMinute:600,endMinute:660},
    {id:'future',routineId:'english',date:'2026-10-26',title:'날짜별 변경',startMinute:700,endMinute:760},
    {id:'single',routineId:null,date:'2026-10-26',title:'별도 계획',startMinute:800,endMinute:860}];
  assert.equal(routineCatalog(versions).length,0);
  assert.equal(plansForDate(versions,entries,'2026-10-23')[0].title,'지난 계획');
  assert.equal(plansForDate(versions,[],'2026-10-21')[0].title,'영어');
  assert.deepEqual(plansForDate(versions,entries,'2026-10-26').map(plan=>plan.title),['별도 계획']);
  assert.equal(routineCatalog([routine({deleted:true})]).length,1,'Paused routines must remain resumable');
  assert.equal(routineInput(routine({removed:true,deleted:false})).deleted,true);
  const staleEdit=[...versions,routine({revision:3,effectiveDate:'2026-10-25'})];
  assert.equal(routineCatalog(staleEdit).length,0);
  assert.equal(plansForDate(staleEdit,[],'2026-10-26').length,0,'A stale window must not resurrect a removed routine');
  assert.equal(plansForDate(staleEdit.slice().reverse(),[],'2026-10-26').length,0);
});

function serviceFixture() {
  const documents=new Map(),writes=[],watchers=[];let next=0;
  const db={};
  const context=vm.createContext({db,entryInput,overrideId,routineInput,planToday:()=> '2026-10-24',
    collection:(_db,...parts)=>({path:parts.join('/')}),
    doc:(base,...parts)=>base===db ? {path:parts.join('/'),id:parts.at(-1)}
      : {path:`${base.path}/${parts[0] || `id${++next}`}`,id:parts[0] || `id${next}`},
    query:(ref,...filters)=>({...ref,filters}),where:(field,op,value)=>({field,op,value}),
    onSnapshot:(ref,callback,error)=>{watchers.push({ref,callback,error});return ()=>{};},
    serverTimestamp:()=> 'timestamp',deleteDoc:async ref=>{documents.delete(ref.path);writes.push({type:'delete',path:ref.path});},
    runTransaction:async(_db,fn)=>{
      const queued=[];
      const result=await fn({get:async ref=>({exists:()=>documents.has(ref.path),data:()=>documents.get(ref.path)}),
        set:(ref,data)=>queued.push({type:'set',path:ref.path,data}),delete:ref=>queued.push({type:'delete',path:ref.path})});
      for(const operation of queued){writes.push(operation);if(operation.type==='set')documents.set(operation.path,operation.data);else documents.delete(operation.path);}
      return result;
    },
  });
  const source=fs.readFileSync('src/features/plans/planService.js','utf8').replace(/import[\s\S]*?from\s*['"][^'"]+['"];?/g,'').replace(/export\s+(?=(?:async )?(?:const|function))/g,'');
  vm.runInContext(source+'\nglobalThis.service={saveRoutine,savePlanEntry,removePlanEntry,subscribeRoutines,subscribePlanEntries};',context);
  return {documents,writes,watchers,service:context.service};
}
test('routine edits append revisions and atomically convert a single-day plan without writing actual activity records',async()=>{
  const f=serviceFixture(),base={title:'영어',startMinute:540,endMinute:600};
  const id=await f.service.savePlanEntry('alice',{...base,date:'2026-10-24'});
  const routineId=await f.service.saveRoutine('alice',{...base,effectiveDate:'2026-10-24',weekdays:[6]}, {clearEntryId:id});
  assert.equal(f.documents.has(`dayPlans/alice/entries/${id}`),false);
  await f.service.saveRoutine('alice',{...base,effectiveDate:'2026-10-25',weekdays:[0],deleted:true},{routineId});
  const versions=[...f.documents].filter(([path])=>path.includes('/routines/')).map(([,data])=>data);
  assert.deepEqual(versions.map(version=>version.revision),[1,2]);assert.equal(versions[0].deleted,false);
  assert.equal(versions[1].deleted,true);assert.ok(f.writes.every(write=>write.path.startsWith('dayPlans/alice')));
  await f.service.saveRoutine('alice',{...base,effectiveDate:'2026-10-24',weekdays:[6],removed:true},{routineId});
  const removed=[...f.documents].filter(([path])=>path.includes('/routines/')).map(([,data])=>data);
  assert.equal(removed.length,3);assert.equal(removed[2].removed,true);assert.equal(removed[2].deleted,true);
  assert.equal(routineCatalog(removed).length,0);assert.equal(removed[0].deleted,false);
});
test('day overrides have stable IDs, preserve creation time and protect another date from accidental updates',async()=>{
  const f=serviceFixture(),base={title:'영어',startMinute:540,endMinute:600,date:'2026-10-24',routineId:'english'};
  const id=await f.service.savePlanEntry('alice',base);
  assert.equal(id,'2026-10-24_english');
  await f.service.savePlanEntry('alice',{...base,startMinute:600,endMinute:660});
  assert.equal(f.documents.get(`dayPlans/alice/entries/${id}`).createdAt,'timestamp');
  const single=await f.service.savePlanEntry('alice',{...base,routineId:null});
  await assert.rejects(f.service.savePlanEntry('alice',{...base,date:'2026-10-25',routineId:null},single));
  await assert.rejects(f.service.saveRoutine('',routine()));
  f.service.subscribePlanEntries('alice',planDateWindow(base.date),()=>{},()=>{});
  assert.equal(f.watchers[0].ref.path,'dayPlans/alice/entries');
  assert.deepEqual(f.watchers[0].ref.filters[0].value,planDateWindow(base.date));
  f.service.subscribeRoutines('bob',()=>{},()=>{});assert.equal(f.watchers[1].ref.path,'dayPlans/bob/routines');
});
