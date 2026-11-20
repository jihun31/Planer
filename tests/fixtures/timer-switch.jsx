import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerTab from '../../src/components/tabs/PlannerTab.jsx';
import '../../src/styles/index.js';
const history=[{effectiveDate:'1000-01-01',startHour:8,endHour:3}];
// App.jsx처럼 다음 활동 선택을 기록·통제 화면 중 맞는 쪽 타이머로 보낸다.
function Harness(){
  const [target,setTarget]=useState(null);
  // App.jsx처럼 다른 화면을 보는 동안 패널을 숨기고, 다음 활동 창이 뜨면 그 화면을 보여 준다.
  const [hiddenView,setHiddenView]=useState(null);globalThis.hideTimerView=setHiddenView;
  const props={uid:'switch-user',scheduleHistory:history,settingsReady:true,onTimerSwitch:(view,activityId)=>setTarget({view,activityId}),
    onTimerPrompt:view=>setHiddenView(hidden=>hidden===view?null:hidden)};
  return <main style={{maxWidth:1280,margin:'24px auto'}}>
    <section id="study" hidden={hiddenView==='planner'}><PlannerTab {...props} switchTarget={target?.view==='planner'?target:null}/></section>
    <section id="control" hidden={hiddenView==='control'} style={{marginTop:30}}><PlannerTab {...props} control switchTarget={target?.view==='control'?target:null}/></section>
  </main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
