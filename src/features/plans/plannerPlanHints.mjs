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
  for(const [index,plan] of plans.entries()){
    const overlapping=records.filter(block=>block.startMin<plan.endMin&&block.endMin>plan.startMin);
    const matches=block=>plan.activityId
      ? !block._opposite&&!block.customName&&block.activityId===plan.activityId
      : !block._opposite&&(block.customName||block.activityName)===plan.title;
    if(overlapping.some(block=>!matches(block)))continue;
    const showLabel=overlapping.length===0;
    for(let minute=plan.startMin;minute<plan.endMin;minute++){
      if(!minutes.has(minute))minutes.set(minute,[]);
      minutes.get(minute).push({index,title:plan.title,color:plan.color||plan.activityColor||'#6366f1',showLabel});
    }
  }
  return plannedCalendarSegments(minutes);
}

// Split each contiguous set of the same plans into one segment per calendar row
// (minutes are 08:00-based, so rows still start on the hour). Adjacent rows of
// one group share an open edge, so a plan that wraps reads as a single outline;
// only the widest row piece shows the label.
function plannedCalendarSegments(minutes) {
  const groups = [];
  const hourOf = minute => Math.floor(minute / 60);
  let group;
  let segment;

  for (const minute of [...minutes.keys()].sort((a, b) => a - b)) {
    const active = minutes.get(minute);
    const key = active.map(plan => plan.index).join(',');
    if (!group || minute !== segment.endMin || key !== group.key) {
      group = { key, label: active.every(plan => plan.showLabel), segments: [] };
      groups.push(group);
    } else if (hourOf(minute) === hourOf(segment.startMin)) {
      segment.endMin++;
      continue;
    }
    segment = {
      startMin: minute,
      endMin: minute + 1,
      title: [...new Set(active.map(plan => plan.title))].join(' · '),
      color: active[0].color,
      showLabel: false,
      outline: {},
    };
    group.segments.push(segment);
  }

  const width = part => part.endMin - part.startMin;
  const column = part => part.startMin - 60 * hourOf(part.startMin);
  function gap(part, side, start, end) {
    part.outline['--plan-' + side + '-start'] = (start - column(part)) * 100 / width(part) + '%';
    part.outline['--plan-' + side + '-end'] = (end - column(part)) * 100 / width(part) + '%';
  }

  return groups.flatMap(({ label, segments }) => {
    let widest = segments[0];
    for (let index = 1; index < segments.length; index++) {
      const upper = segments[index - 1];
      const lower = segments[index];
      if (width(lower) > width(widest)) widest = lower;

      // Only the shared part of the edge is inside the outline. A wrapped
      // partial row can still have a horizontal edge beyond the adjacent row.
      const start = Math.max(column(upper), column(lower));
      const end = Math.min(column(upper) + width(upper), column(lower) + width(lower));
      if (end > start) {
        gap(upper, 'bottom', start, end);
        gap(lower, 'top', start, end);
      }
    }
    widest.showLabel = label;
    return segments;
  });
}
