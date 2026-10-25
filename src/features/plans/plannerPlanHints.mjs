import { plansForDate, planToday } from './planModel.mjs';
import { planActivity } from './planTimetable.mjs';
import { blockMinutes } from '../planner/scheduleTime.mjs';

// Match an activity's #RRGGBB30 fill on white with an opaque color. An
// overlapping grid line or actual fill must not darken one side of the frame.
export function planOutlineColor(color) {
  const base=/^#[0-9a-f]{6}$/i.test(color)?color:'#6366f1';
  return '#'+[1,3,5].map(index=>Math.round((parseInt(base.slice(index,index+2),16)*48+255*207)/255).toString(16).padStart(2,'0')).join('');
}

function registeredDate(version) {
  const timestamp=version.createdAt?.toMillis?.() ?? (Number.isFinite(version.createdAt?.seconds)?version.createdAt.seconds*1000:null);
  const created=timestamp===null?null:new Date(timestamp);
  const date=created&&!Number.isNaN(created.getTime())?planToday(created):version.effectiveDate;
  return date>version.effectiveDate?date:version.effectiveDate;
}

// Resolve only the opened day. No per-day future documents are generated.
export function projectPlannerPlans(versions,entries,date,activities=[]) {
  const starts=new Map();
  for(const version of versions){
    const start=registeredDate(version),previous=starts.get(version.routineId);
    if(!previous||start<previous)starts.set(version.routineId,start);
  }
  return plansForDate(versions.filter(version=>registeredDate(version)<=date),entries.filter(entry=>
    !entry.routineId||!starts.has(entry.routineId)||starts.get(entry.routineId)<=date),date)
    .filter(plan=>!plan.skipped).map(plan=>({...planActivity(plan,activities),startMin:plan.startMinute-480,endMin:plan.endMinute-480}));
}

// A different recorded activity replaces the entire plan hint. Matching records
// retain the outline, with only the actual activity's label shown.
export function planHintRuns(plans,occupiedBlocks) {
  const records=occupiedBlocks.map(block=>({...block,...blockMinutes(block)})),minutes=new Map();
  for(const plan of plans){
    const overlapping=records.filter(block=>block.startMin<plan.endMin&&block.endMin>plan.startMin);
    const matches=block=>plan.activityId
      ? !block._opposite&&!block.customName&&block.activityId===plan.activityId
      : !block._opposite&&(block.customName||block.activityName)===plan.title;
    if(overlapping.some(block=>!matches(block)))continue;
    const showLabel=overlapping.length===0;
    for(let minute=plan.startMin;minute<plan.endMin;minute++){
      if(!minutes.has(minute))minutes.set(minute,[]);
      minutes.get(minute).push({title:plan.title,color:plan.color||plan.activityColor||'#6366f1',showLabel});
    }
  }
  const runs=[];
  for(const minute of [...minutes.keys()].sort((a,b)=>a-b)){
    const items=minutes.get(minute),title=[...new Set(items.map(item=>item.title))].join(' · '),color=items[0].color,showLabel=items.every(item=>item.showLabel),previous=runs.at(-1);
    if(previous&&previous.endMin===minute&&previous.title===title&&previous.color===color&&previous.showLabel===showLabel&&Math.floor((previous.startMin+480)/60)===Math.floor((minute+480)/60))previous.endMin++;
    else runs.push({startMin:minute,endMin:minute+1,title,color,showLabel});
  }
  return runs;
}
