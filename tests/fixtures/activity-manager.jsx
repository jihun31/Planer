import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ActivityManager from '../../src/components/planner/ActivityManager.jsx';
import '../../src/styles/app.css';
import '../../src/styles/planner.css';

globalThis.activityManagerWrites={study:{adds:[],orders:[]},control:{adds:[],orders:[]}};
export function Preview({control=false}) {
  const id=control?'control':'study',writes=globalThis.activityManagerWrites[id];
  const [activities,setActivities]=useState([
    {id:'a',name:'독서',color:'#6366f1',group:'controlled'},
    {id:'b',name:'운동',color:'#f97316',group:'foolish'},
  ]);
  return <section id={id}>
    <ActivityManager activities={activities} control={control}
      onAdd={async input=>{writes.adds.push(input);await new Promise(resolve=>setTimeout(resolve,40));setActivities(previous=>[...previous,{...input,id:'new'}]);}}
      onDelete={async key=>{await new Promise(resolve=>setTimeout(resolve,40));setActivities(previous=>previous.filter(activity=>activity.id!==key));}}
      onUpdateOrder={async ids=>{writes.orders.push(ids);}}
      onUpdateGroup={async(key,group)=>setActivities(previous=>previous.map(activity=>activity.id===key?{...activity,group}:activity))}/>
    <button className="clear-external" onClick={()=>setActivities([])}>다른 창에서 모두 삭제</button>
  </section>;
}
createRoot(document.getElementById('root')).render(<main><Preview/><Preview control/></main>);
