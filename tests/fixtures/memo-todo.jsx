import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {NoteTextEditor} from '../../src/components/notes/NoteTextEditor.jsx';
import ActivityManager from '../../src/components/planner/ActivityManager.jsx';
import {AllTasksBlock} from '../../src/components/today/TasksPanel.jsx';
import '../../src/styles/app.css';
import '../../src/styles/notes.css';
import '../../src/styles/planner.css';
import '../../src/styles/tasks.css';

globalThis.colorWrites=[];globalThis.deletedTodos=[];
function Preview(){
  const [text,setText]=useState(''),[version,setVersion]=useState(0);
  const [activities,setActivities]=useState([{id:'a',uid:'u',name:'독서',color:'#6366f1'},{id:'b',uid:'u',name:'운동',color:'#f97316'}]);
  const [todos,setTodos]=useState([{id:'t1',title:'보고서',dueDate:'2026-11-20',completed:false},{id:'t2',title:'장보기',dueDate:null,completed:false}]);
  globalThis.memoText=text;
  globalThis.applyTodoUpdate=(id,data)=>setTodos(previous=>previous.map(todo=>todo.id===id?{...todo,...data}:todo));
  return <main style={{maxWidth:800,margin:'24px auto'}}>
    <button id="reopen" onClick={()=>setVersion(value=>value+1)}>다시 열기</button>
    <NoteTextEditor key={version} text={text} edit={setText} loading={false} readOnly={false}/>
    <section id="activities"><ActivityManager activities={activities} onAdd={async()=>{}} onDelete={async()=>{}} onUpdateOrder={async()=>{}} onStart={()=>{}}
      onUpdateColor={async(activity,color)=>{globalThis.colorWrites.push([activity.id,color]);await new Promise(resolve=>setTimeout(resolve,30));
        setActivities(previous=>previous.map(item=>item.id===activity.id?{...item,color}:item));}}/></section>
    <section id="control"><ActivityManager control activities={activities} onAdd={async()=>{}} onDelete={async()=>{}} onUpdateOrder={async()=>{}} onUpdateGroup={async()=>{}} onStart={()=>{}}/></section>
    <section id="todos"><AllTasksBlock tasks={todos} onDelete={id=>globalThis.deletedTodos.push(id)} onManage={()=>{}}/></section>
  </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
