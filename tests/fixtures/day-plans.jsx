import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DayPlanBlock} from '../../src/components/today/DayPlanBlock.jsx';
import {plansForDate,routineCatalog,overlappingPlanKeys,overrideId,planToday,shiftPlanDate} from '../../src/features/plans/planModel.mjs';
import '../../src/styles/app.css';
import {rangeForDate} from '../../src/features/planner/scheduleTime.mjs';
export function Preview(){
  const [date,setDate]=useState(planToday()),[versions,setVersions]=useState([]),[entries,setEntries]=useState([]);
  const [activities,setActivities]=useState([{id:'english',name:'영어 공부',color:'#22c55e'}, {id:'exercise',name:'운동',color:'#f97316'}, {id:'archived',name:'숨긴 활동',color:'#ef4444',archived:true}]);
  const [history,setHistory]=useState([{startHour:8,endHour:3,effectiveDate:planToday()}, {startHour:10,endHour:23,effectiveDate:shiftPlanDate(planToday(),7)}]);
  globalThis.planTestState={date,versions,entries,activities};
  const data={plans:plansForDate(versions,entries,date),routines:routineCatalog(versions),overlaps:overlappingPlanKeys(versions,entries,date),loading:false,error:null,
    saveRoutine:async(input,{routineId,clearEntryId}={})=>{setVersions(prev=>[...prev,{...input,routineId:routineId||'routine-1',revision:prev.length+1}]);if(clearEntryId)setEntries(prev=>prev.filter(item=>item.id!==clearEntryId));},
    saveEntry:async(input,id)=>setEntries(prev=>{const key=input.routineId?overrideId(input.date,input.routineId):id||'single-1';return [...prev.filter(item=>item.id!==key),{...input,id:key}];}),
    removeEntry:async id=>setEntries(prev=>prev.filter(item=>item.id!==id))};
  return <main style={{maxWidth:1200,margin:'24px auto'}}><p id="shared-date">날짜별 할 일: {date}</p><button id="next-week" onClick={()=>setDate(shiftPlanDate(date,7))}>다음 주</button><button id="previous-week" onClick={()=>setDate(shiftPlanDate(date,-7))}>이전 주</button>
    <button id="rename-activity" onClick={()=>setActivities(previous=>previous.map(activity=>activity.id==='english'?{...activity,name:'영어 회화',color:'#3b82f6'}:activity))}>활동 변경</button>
    <button id="archive-activity" onClick={()=>setActivities(previous=>previous.map(activity=>activity.id==='english'?{...activity,archived:true}:activity))}>활동 숨김</button>
    <button id="narrow-range" onClick={()=>setHistory([{startHour:10,endHour:23,effectiveDate:planToday()}])}>범위 변경</button>
    <DayPlanBlock date={date} onDateChange={setDate} data={data} activities={activities.filter(activity=>!activity.archived)} allActivities={activities} range={rangeForDate(history,date)}/></main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
