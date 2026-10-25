import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {NoteTextEditor} from '../../src/components/notes/NoteTextEditor.jsx';
import '../../src/styles/app.css';
import '../../src/styles/notes.css';
export function Preview(){
  const [text,setText]=useState(''),[version,setVersion]=useState(0),[readOnly,setReadOnly]=useState(false);
  globalThis.checklistText=text;
  return <main style={{maxWidth:800,margin:'24px auto'}}>
    <button id="reopen" onClick={()=>setVersion(value=>value+1)}>다시 열기</button>
    <button id="reset" onClick={()=>{setText('');setVersion(value=>value+1);}}>초기화</button>
    <button id="readonly" onClick={()=>setReadOnly(value=>!value)}>읽기 전용</button>
    <NoteTextEditor key={version} text={text} edit={setText} loading={false} readOnly={readOnly}/>
  </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
