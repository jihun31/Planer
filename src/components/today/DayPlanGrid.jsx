import { useState } from 'react';
import { MINUTES_ARR, fmtHour } from '../planner/plannerDisplay.mjs';
import { planTime } from '../../features/plans/planModel.mjs';
import { planHours } from '../../features/plans/planTimetable.mjs';

// Plans use midnight-based minutes; the actual-record timetable keeps its own
// 08:00-based storage. Only the timetable's visual layout is shared here.
export default function DayPlanGrid({plans,selection,onSelect,onEdit,onRemove,disabled,range}) {
  const [hovered,setHovered]=useState(null);
  const cellPlans=new Map();
  for(const plan of plans)for(let minute=plan.startMinute;minute<plan.endMinute;minute++){
    if(!cellPlans.has(minute))cellPlans.set(minute,[]);
    cellPlans.get(minute).push(plan);
  }
  const hours=planHours(range,plans,selection);
  function choose(minute,plan){
    if(disabled)return;
    if(selection?.pending){
      if(minute===selection.startMinute){onSelect(null);return;}
      onSelect({startMinute:Math.min(selection.startMinute,minute),endMinute:Math.max(selection.startMinute,minute)+1,pending:false});
    }else if(plan)onEdit(plan);
    else onSelect({startMinute:minute,endMinute:minute+1,pending:true});
  }
  function navigate(event,minute){
    const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-60,ArrowDown:60}[event.key];
    if(delta){
      event.preventDefault();event.stopPropagation();
      event.currentTarget.closest('.ds-table').querySelector(`[data-plan-minute="${minute+delta}"]`)?.focus();
    }
  }
  const previewStart=selection?.pending&&hovered!==null?Math.min(selection.startMinute,hovered):selection?.startMinute;
  const previewEnd=selection?.pending&&hovered!==null?Math.max(selection.startMinute,hovered)+1:selection?.endMinute;
  return <div className="daily-schedule day-plan-timetable" aria-label="계획 시간표">
    <div className="ds-scroll"><div className="ds-table" onMouseLeave={()=>setHovered(null)}>
      <div className="ds-th ds-th-time">시간</div>
      {MINUTES_ARR.map(minute=><div key={minute} className={`ds-th${minute%15===0?' ds-th-quarter':[14,29,44].includes(minute)?' ds-th-qend':' ds-th-minor'}`}>
        {minute%15===0?`:${String(minute).padStart(2,'0')}`:''}</div>)}
      {hours.map(hour=><div key={hour} style={{display:'contents'}}>
        <div className="ds-td-time">{fmtHour(hour)}</div>
        {MINUTES_ARR.map(offset=>{
          const minute=hour*60+offset,items=cellPlans.get(minute)||[],plan=items.at(-1);
          const selected=minute>=previewStart&&minute<previewEnd;
          const editing=plan&&selection?.editingKey===plan.key;
          const sameRight=plan&&cellPlans.get(minute+1)?.at(-1)?.key===plan.key;
          const cls=['ds-td',plan?'ds-td-filled':'',selected?(selection.pending?'ds-td-preview':'ds-td-confirmed'):'',editing?'day-plan-cell-editing':'',
            [14,29,44].includes(offset)&&!sameRight?'ds-td-quarter-end':'',offset%5===4&&!sameRight?'ds-td-five-end':'',items.length>1?'day-plan-cell-overlap':''].filter(Boolean).join(' ');
          const label=`${planTime(minute%1440)}${items.length?` ${items.map(item=>item.title).join(' / ')}`:' 빈칸'}`;
          return <div key={offset} className={cls} style={plan?{background:plan.color+'30'}:undefined}>
            <button type="button" className="day-plan-cell" data-plan-minute={minute} aria-label={label} title={label}
              aria-pressed={!!selected} tabIndex={minute===(selection?.startMinute??hours[0]*60)?0:-1}
              disabled={disabled} onKeyDown={event=>navigate(event,minute)}
              onClick={()=>choose(minute,plan)} onMouseEnter={()=>setHovered(minute)} />
            {plan&&minute===Math.floor((plan.startMinute+plan.endMinute)/2)&&plan.endMinute-plan.startMinute>=5&&<span className="ds-cell-name" style={{color:plan.color}}>{plan.title}</span>}
            {plan&&minute===plan.startMinute&&<button type="button" className="ds-del" aria-label={`${plan.title} ${plan.routineId?'이번 날짜 제외':'계획 삭제'}`}
              disabled={disabled} onClick={()=>onRemove(plan)}>✕</button>}
          </div>;
        })}
      </div>)}
    </div></div>
  </div>;
}
