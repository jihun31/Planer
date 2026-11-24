import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import HabitsTab from '../../src/components/tabs/HabitsTab.jsx';
import TodayHabitsBlock from '../../src/components/today/TodayHabitsBlock.jsx';
import TodayMain from '../../src/components/today/TodayMain.jsx';
import TaskReminder from '../../src/components/planner/TaskReminder.jsx';
import { orderHabits } from '../../src/features/habits/habitCore.mjs';
import '../../src/styles/app.css';
import '../../src/styles/tasks.css';

// 2026-11-20(금)로 고정. 어제(19일)는 빠져서 '두 번 연속은 피하기' 안내가 보여야 한다.
const TODAY='2026-11-20';
globalThis.writes=[];globalThis.failWrites=false;
const later=()=>new Promise(resolve=>setTimeout(resolve,20));
const write=async(entry)=>{await later();if(globalThis.failWrites)throw Error('offline');globalThis.writes.push(entry);};

function Preview(){
  const [orderedIds,setOrderedIds]=useState([]);
  const [habits,setHabits]=useState([{id:'water',name:'물 마시기',emoji:'💧',anchor:'아침에 일어나서',tinyVersion:'한 모금',
    schedule:{type:'daily'},startDate:'2026-11-01',archived:false,logs:{'2026-11-03':'full','2026-11-10':'full','2026-11-11':'full','2026-11-17':'full','2026-11-18':'full'},automaticity:{'2026-11-09':4}},
    {id:'gallery',name:'갤러리 정리',emoji:'📷',anchor:'',tinyVersion:'',schedule:{type:'monthdays',days:[1]},startDate:'2026-08-20',archived:false,logs:{'2026-10-01':'full'}}]);
  const patch=(id,change)=>setHabits(list=>list.map(h=>h.id===id?{...h,...change(h)}:h));
  const habitsData={habits:orderHabits(habits,orderedIds),today:TODAY,loading:false,error:null,orderReady:true,
    saveOrder:async ids=>{await write(['order',ids]);setOrderedIds(ids);},
    addHabit:async value=>{await write(['add',value]);setHabits(list=>[...list,{...value,id:'h'+list.length,archived:false,logs:{}}]);},
    updateHabit:async(id,value)=>{await write(['update',id,value]);patch(id,()=>value);},
    archiveHabit:async id=>{await write(['archive',id]);patch(id,()=>({archived:true}));},
    restoreHabit:async id=>{await write(['restore',id]);patch(id,()=>({archived:false}));},
    deleteHabit:async id=>{await write(['delete',id]);setHabits(list=>list.filter(h=>h.id!==id));},
    setAutomaticity:async(id,week,score)=>{await write(['auto',id,week,score]);patch(id,h=>({automaticity:{...h.automaticity,[week]:score}}));},
    setLog:async(id,day,value)=>{await write(['log',id,day,value]);patch(id,h=>{const logs={...h.logs};if(value)logs[day]=value;else delete logs[day];return {logs};});},
  };
  return <main style={{display:'grid',gridTemplateColumns:'320px 1fr',gap:16,padding:16,alignItems:'start'}}>
    <section id="today"><TodayHabitsBlock habitsData={habitsData} onOpen={()=>{globalThis.opened=true;}}/></section>
    <section id="tab"><HabitsTab uid="tester" habitsData={habitsData}/></section>
    <section id="plan"><TodayMain tasks={[]} habits={habitsData.habits} onSetHabitLog={habitsData.setLog} selectedDate={TODAY}
      onAdd={async()=>{}} onToggle={()=>{}} onDelete={()=>{}} onDateChange={()=>{}}/></section>
    <section id="reminder"><TaskReminder tasks={[{id:'evening-task',title:'저녁 할 일',timeSlot:'저녁',dueDate:TODAY,completed:false}]}
      onToggle={async()=>{}} habits={habitsData.habits} onSetHabitLog={habitsData.setLog}/></section>
  </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
