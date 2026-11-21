import {useState} from 'react';

// 타이머 전환 화면 테스트용 기록·통제 데이터. 저장한 타이머 기록은 timerSwitchSaves에 남긴다.
const studyActivities=[{id:'lecture',name:'강의',color:'#ef4444'},{id:'old',name:'보관한 공부',color:'#22c55e',archived:true}];
const controlActivities=[{id:'youtube',name:'유튜브',group:'foolish',color:'#dc2626'},{id:'move',name:'이동',group:'controlled',color:'#2563eb'}];
const saves=[];globalThis.timerSwitchSaves=saves;
function usePreview(uid,control){
  const own=control?controlActivities:studyActivities,other=control?studyActivities:controlActivities;
  const [blocks,setBlocks]=useState([]);
  return {activities:own.filter(activity=>!activity.archived),allActivities:own,blocks,oppositeBlocks:[],oppositeActivities:other,loading:false,error:null,
    retryLoading:()=>{},addActivity:()=>{},deleteActivity:()=>{},deleteBlock:async()=>{},updateActivityOrder:()=>{},updateActivityGroup:()=>{},addBlock:async()=>{},
    saveTimer:async data=>{
      await globalThis.timerSwitchBeforeSave?.(data);
      const {startTs,segments,metadata}=data;
      saves.push({...metadata,control,startTs,segments});
      setBlocks(previous=>[...previous,...segments.map((segment,index)=>({
        ...metadata,...segment,id:(control?'control':'study')+'-'+startTs+'-'+index,
      }))]);
    }};
}
export const usePlanner=(uid)=>usePreview(uid,false);
export const useControl=(uid)=>usePreview(uid,true);
export const useDayPlans=()=>({versions:[],entries:[],loading:false,error:null,retry:()=>{}});
