import {useEffect,useState} from 'react';
import {plannerDate} from '../../src/features/planner/scheduleTime.mjs';
const date=plannerDate();
const studyActivities=[{id:'actual',name:'실제 공부',color:'#22c55e'},{id:'planned',name:'계획 공부',color:'#6366f1'}];
const controlActivities=[{id:'leisure',name:'통제 활동',group:'controlled',color:'#0d9488'}];
const versions=[{routineId:'study',revision:1,title:'계획 공부',activityId:'planned',startMinute:540,endMinute:600,weekdays:[0,1,2,3,4,5,6],effectiveDate:date,deleted:false},
  {routineId:'evening',revision:2,title:'계획 공부',activityId:'planned',startMinute:1110,endMinute:1170,weekdays:[0,1,2,3,4,5,6],effectiveDate:date,deleted:false}];
const writes=[];globalThis.plannerPreviewWrites=writes;
function usePreview(uid,year,month,selectedDate,control){
  const [ready,setReady]=useState(null),[records,setRecords]=useState([]);
  const scope=`${uid}/${year}/${month}/${selectedDate}`;
  useEffect(()=>{if(!uid)return;const timer=setTimeout(()=>setReady(scope),350);return()=>clearTimeout(timer);},[uid,scope]);
  const loading=!!uid&&ready!==scope,activities=control?controlActivities:studyActivities;
  const initial=control?{id:'control',date:selectedDate,activityId:'leisure',startMin:80,endMin:100,group:'controlled'}:{id:'study',date:selectedDate,activityId:'actual',startMin:80,endMin:100};
  return {activities,allActivities:activities,blocks:!uid||loading?[]:[initial,...records],oppositeBlocks:[],oppositeActivities:[],loading,error:null,
    retryLoading:()=>{},addActivity:()=>{},deleteActivity:()=>{},saveTimer:()=>{throw Error('Unexpected timer save');},deleteBlock:async id=>setRecords(previous=>previous.filter(block=>block.id!==id)),updateActivityOrder:()=>{},updateActivityGroup:()=>{},
    addBlock:async block=>{writes.push({...block,control});setRecords(previous=>[...previous,{...block,id:`new-${previous.length}`}]);}};
}
export const usePlanner=(uid,year,month,selectedDate)=>usePreview(uid,year,month,selectedDate,false);
export const useControl=(uid,year,month,selectedDate)=>usePreview(uid,year,month,selectedDate,true);
export const useDayPlans=uid=>({versions:uid?versions:[],entries:[],loading:false,error:null,retry:()=>{}});
