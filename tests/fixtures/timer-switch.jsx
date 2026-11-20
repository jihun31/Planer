import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerTab from '../../src/components/tabs/PlannerTab.jsx';
import '../../src/styles/index.js';
const history=[{effectiveDate:'1000-01-01',startHour:8,endHour:3}];
// App.jsx처럼 다음 활동 선택을 기록·통제 화면 중 맞는 쪽 타이머로 보낸다.
function Harness(){
  const [target,setTarget]=useState(null);
  const props={uid:'switch-user',scheduleHistory:history,settingsReady:true,onTimerSwitch:(view,activityId)=>setTarget({view,activityId})};
  return <main style={{maxWidth:1280,margin:'24px auto'}}>
    <section id="study"><PlannerTab {...props} switchTarget={target?.view==='planner'?target:null}/></section>
    <section id="control" style={{marginTop:30}}><PlannerTab {...props} control switchTarget={target?.view==='control'?target:null}/></section>
  </main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
