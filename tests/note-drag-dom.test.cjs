const fs=require('node:fs');
const path=require('node:path');

if(!process.versions.electron){
  const temporary=path.resolve(__dirname,'../.tmp');fs.mkdirSync(temporary,{recursive:true});
  const profile=fs.mkdtempSync(path.join(temporary,'note-drag-test-'));
  const env={...process.env,PLANER_NOTE_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  try{
    const result=require('node:child_process').spawnSync(require('electron'),[__filename],{env,stdio:'inherit',timeout:45000});
    if(result.error)throw result.error;
    process.exitCode=result.status??1;
  }finally{
    if(path.dirname(profile)===temporary&&path.basename(profile).startsWith('note-drag-test-'))fs.rmSync(profile,{recursive:true,force:true});
    else {console.error('Unexpected test profile; cleanup skipped');process.exitCode=1;}
  }
}else{
  const {app,BrowserWindow}=require('electron');
  app.setPath('userData',process.env.PLANER_NOTE_TEST_PROFILE);app.disableHardwareAcceleration();
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    try{
      await win.loadFile(path.join(__dirname,'fixtures/note-editor.html'));
      const result=await win.webContents.executeJavaScript(`(async()=>{
        const {createNoteToggle,noteHtml,noteRuns,notePlainText,serializeNoteRuns}=await import('../../src/features/notes/noteRichText.mjs');
        const {readNoteEditor}=await import('../../src/features/notes/noteEditorDom.mjs');
        const {prepareNoteTextMove,applyNoteTextMove}=await import('../../src/features/notes/noteTextDrag.mjs');
        const {noteSlashShortcut}=await import('../../src/features/notes/noteSlashCommands.mjs');
        const {changeNoteListDepth}=await import('../../src/features/notes/noteListEditing.mjs');
        const root=document.getElementById('editor');
        const assert=(value,message)=>{if(!value)throw Error(message);};
        const body=run=>notePlainText(serializeNoteRuns(run.children));
        const snapshots=[];
        const reset=()=>{
          const toggles=Array.from({length:6},(_,index)=>{
            const value=createNoteToggle([{text:'TITLE '+(index+1)+'\\nBODY '+(index+1),color:'#787774'}]);
            value.open=index===4;return value;
          });
          toggles[1].children.push(createNoteToggle([{text:'NESTED TITLE\\nNESTED BODY'}]));
          toggles[1].children.at(-1).open=false;
          root.innerHTML=noteHtml(serializeNoteRuns([{text:'MOVE ME',bold:true},...toggles]),true);
        };
        for(const destinationIndex of [0,1,4,5]){
          reset();
          const before=readNoteEditor(root),original=noteRuns(before).filter(run=>run.block==='toggle');
          const source=root.firstChild.firstChild,range=document.createRange();range.selectNodeContents(source);
          const header=root.querySelectorAll(':scope > details > summary')[destinationIndex];
          document.elementFromPoint=()=>header;
          const moved=prepareNoteTextMove(root,{editor:root,range,text:readNoteEditor(range.cloneContents())},{target:header,clientX:0,clientY:0});
          assert(moved,'Move preparation rejected');
          const caret=applyNoteTextMove(root,moved);assert(caret,'Move rejected');
          const after=readNoteEditor(root),actual=noteRuns(after).filter(run=>run.block==='toggle');
          assert(after===moved.text,'Applied document differs from prepared move');
          assert(actual.length===6,'Move duplicated or removed toggles');
          assert(root.querySelectorAll('details').length===7,'Nested toggle structure changed');
          for(let i=0;i<6;i++){
            assert(JSON.stringify(actual[i].summary)===JSON.stringify(original[i].summary),'Title changed at '+i);
            assert(body(actual[i])===body(original[i])+(i===destinationIndex?'\\nMOVE ME':''),'Body changed at '+i);
            assert(actual[i].open===(i===destinationIndex?true:original[i].open),'Other open state changed');
          }
          assert(root.textContent.match(/MOVE ME/g)?.length===1,'Moved text duplicated');
          assert(!root.querySelector('[data-note-drop-caret]'),'Caret marker was not removed');
          // Structural undo/redo uses the exact serialized before/after snapshots.
          root.innerHTML=noteHtml(before,true);assert(readNoteEditor(root)===before,'Undo changed the document');
          root.innerHTML=noteHtml(after,true);assert(readNoteEditor(root)===after,'Redo changed the document');
          for(const details of root.querySelectorAll('details'))details.open=false;
          const closed=readNoteEditor(root);root.innerHTML=noteHtml(closed,true);
          for(const details of root.querySelectorAll('details'))details.open=true;
          await new Promise(resolve=>requestAnimationFrame(resolve));
          assert(root.innerText.includes('NESTED BODY'),'Nested body missing after reopen');
          for(let i=1;i<=6;i++)assert(root.innerText.includes('BODY '+i),'Body missing after reopen: '+i);
          snapshots.push({destination:destinationIndex+1,characters:notePlainText(after).length});
        }
        let shortcuts=0;
        const protectedToggle=createNoteToggle([{text:'KEEP TITLE\\nKEEP BODY'}]);protectedToggle.open=false;
        for(const [command,type]of [['제목','h3'],['인용','quote']])for(const afterSpace of [false,true]){
          root.innerHTML='<div>KEEP BEFORE</div><div><strong>/'+command[0]+'</strong>'+command.slice(1)+(afterSpace?' ':'')+'KEEP AFTER</div>'+noteHtml(serializeNoteRuns([protectedToggle]),true);
          const line=root.children[1],tail=line.lastChild,range=document.createRange();
          range.setStart(tail,command.length-1+(afterSpace?1:0));range.collapse(true);
          root.focus();const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
          const shortcut=noteSlashShortcut(root,selection,afterSpace);assert(shortcut?.type===type,'Slash command not recognized');
          selection.removeAllRanges();selection.addRange(shortcut.range);
          document.execCommand('delete');document.execCommand('formatBlock',false,type==='quote'?'blockquote':type);
          assert(root.querySelector(type==='quote'?'blockquote':'h3')?.textContent==='KEEP AFTER','Command did not format its line');
          assert(root.firstChild.textContent==='KEEP BEFORE','Command changed preceding text');
          const toggle=noteRuns(readNoteEditor(root)).find(run=>run.block==='toggle');
          assert(body(toggle)==='KEEP BODY'&&!toggle.open,'Command changed closed toggle');
          shortcuts++;
        }
        for(const value of ['앞 문장 /제목','/인용문','/모르는명령']){
          root.textContent=value;const range=document.createRange();range.selectNodeContents(root);range.collapse(false);
          getSelection().removeAllRanges();getSelection().addRange(range);
          assert(!noteSlashShortcut(root,getSelection()),'Literal text recognized as a command');
        }
        const focusEnd=element=>{
          root.focus();const range=document.createRange();range.selectNodeContents(element);range.collapse(false);
          getSelection().removeAllRanges();getSelection().addRange(range);
        };
        root.innerHTML='<ul><li>상위 항목</li></ul>'+noteHtml(serializeNoteRuns([protectedToggle]),true);
        focusEnd(root.querySelector('li'));
        assert(changeNoteListDepth(root,getSelection()),'First list item should consume Tab');
        assert(!root.querySelector('ul ul'),'First item cannot be nested without a parent item');
        document.execCommand('insertParagraph');
        assert(root.querySelectorAll('li').length===2,'Enter did not create the next list item');
        assert(changeNoteListDepth(root,getSelection()),'Tab did not indent empty next item');
        let saved=readNoteEditor(root);root.innerHTML=noteHtml(saved,true);
        let child=root.querySelector('ul ul li');assert(child,'Empty nested item lost after reopen');
        assert(getComputedStyle(child.parentElement).listStyleType==='circle','Nested item is not a hollow bullet');
        focusEnd(child);document.execCommand('insertText',false,'세부 항목');
        saved=readNoteEditor(root);root.innerHTML=noteHtml(saved,true);
        child=root.querySelector('ul ul li');assert(child?.textContent==='세부 항목','Nested text lost after reopen');
        assert(readNoteEditor(root)===saved,'Nested list changed after reopen');
        focusEnd(child);assert(changeNoteListDepth(root,getSelection(),true),'Shift+Tab did not outdent');
        assert(!root.querySelector('ul ul'),'Outdented item remains nested');
        assert(root.querySelectorAll(':scope > ul > li').length===2,'Outdenting changed sibling items: '+root.innerHTML);
        document.execCommand('insertText',false,' 계속');
        assert(root.querySelector(':scope > ul > li:last-child').textContent==='세부 항목 계속','Caret moved away from the outdented item');
        assert(body(noteRuns(readNoteEditor(root)).find(run=>run.block==='toggle'))==='KEEP BODY','List editing changed a closed toggle');
        for(const reopen of [false,true]){
          root.innerHTML='<ul><li>상위</li><li><b>세부</b></li><li>다음</li></ul>';
          focusEnd(root.querySelectorAll('li')[1]);
          const before=readNoteEditor(root);
          changeNoteListDepth(root,getSelection());
          const indented=readNoteEditor(root);
          if(reopen){root.innerHTML=noteHtml(indented,true);focusEnd(root.querySelector('ul ul li'));}
          changeNoteListDepth(root,getSelection(),true);
          const after=readNoteEditor(root);
          assert(notePlainText(after)===notePlainText(before),'Indent and outdent changed text');
          assert(!noteRuns(after).some(run=>run.listDepth),'Outdent did not remove nested depth');
          assert(noteRuns(after).some(run=>run.bold&&run.text.includes('세부')),'List editing lost bold text');
          // The editor records these snapshots for structural undo and redo.
          for(const snapshot of [before,indented,after]){
            root.innerHTML=noteHtml(snapshot,true);
            assert(readNoteEditor(root)===snapshot,'List undo or redo snapshot changed after rendering: '+JSON.stringify({reopen,snapshot,actual:readNoteEditor(root),html:root.innerHTML}));
          }
        }
        root.innerHTML='<ul><li>상위<ul><li>세부<ul><li>더 세부</li></ul></li><li>다른 세부</li></ul></li><li>다음</li></ul>';
        focusEnd(root.querySelector('ul ul li'));
        const originalText=notePlainText(readNoteEditor(root));
        changeNoteListDepth(root,getSelection(),true);
        saved=readNoteEditor(root);root.innerHTML=noteHtml(saved,true);
        assert(notePlainText(saved)===originalText,'Outdent lost descendants or following siblings');
        assert(readNoteEditor(root)===saved,'Outdented descendants changed after reopening');
        root.innerHTML='<div>일반 문장</div>';focusEnd(root.firstChild);
        assert(!changeNoteListDepth(root,getSelection()),'Tab outside a list should retain normal focus behavior');
        root.innerHTML='<ul><li>상위<ul><li><b>세부</b><ul><li>더 세부</li></ul></li></ul></li><li>다음</li></ul>';
        saved=readNoteEditor(root);root.innerHTML=noteHtml(saved,true);
        assert(root.querySelector('ul ul ul li')?.textContent==='더 세부','Third list level was flattened');
        assert(readNoteEditor(root)===saved,'Third list level changed after reload');
        return {passed:snapshots.length,shortcuts,nestedLists:true,checks:['closed and open destinations','all six bodies retained','nested closed body retained','no duplicate details','undo and redo snapshots','save and reopen','Korean slash commands preserve surrounding content','Tab and Shift+Tab list nesting','empty and formatted nested list persistence'],snapshots};
      })()`);
      console.log(JSON.stringify(result));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
