import { DEFAULT_RANGE, visibleHours } from '../planner/scheduleTime.mjs';

export function planHours(range=DEFAULT_RANGE,plans=[],selection=null) {
  return visibleHours(range,[...plans,...(selection?[selection]:[])].map(plan=>({
    startMin:plan.startMinute-480,endMin:plan.endMinute-480,
  })));
}
export function planActivity(plan,activities=[]) {
  const activity=plan.activityId ? activities.find(item=>item.id===plan.activityId) : null;
  return {...plan,title:activity?.name||plan.title,color:activity?.color||plan.activityColor||'#6366f1'};
}
