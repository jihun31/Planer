const fs=require('node:fs'),path=require('node:path');
// Memo editing (Ctrl+A line → note, in-line copy/cut), activity color editing and todo editing.
if(!process.versions.electron){
  (async()=>{
    const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
    const root=path.resolve(__dirname,'..'),temporary=path.join(root,'.tmp');fs.mkdirSync(temporary,{recursive:true});
    const profile=fs.mkdtempSync(path.join(temporary,'memo-todo-'));
    const todoStub=path.join(root,'tests/fixtures/todo-service-stub.mjs');
    const server=await createServer({configFile:false,root,cacheDir:path.join(profile,'vite-cache'),plugins:[{
      name:'todo-service-stub',enforce:'pre',resolveId(source){if(source.endsWith('/features/todos/todoService'))return todoStub;},
    },react()],optimizeDeps:{entries:['tests/fixtures/memo-todo.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.tmp/**','**/local-data/**']}},clearScreen:false});
    try{
      await server.listen();const env={...process.env,PLANER_MEMO_PROFILE:profile,PLANER_MEMO_URL:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/memo-todo.html`};delete env.ELECTRON_RUN_AS_NODE;
      const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'}),timeout=setTimeout(()=>child.kill(),60000);
      process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code??1));child.once('error',reject);});clearTimeout(timeout);
    }finally{await server.close();if(path.dirname(profile)===temporary&&path.basename(profile).startsWith('memo-todo-'))fs.rmSync(profile,{recursive:true,force:true});}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}else{
  const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.PLANER_MEMO_PROFILE);app.disableHardwareAcceleration();
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:1100,height:900,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    try{
      await win.loadURL(process.env.PLANER_MEMO_URL);
      await win.webContents.executeJavaScript(`new Promise(resolve=>{const wait=()=>document.querySelector('.notes-text-editor')?resolve():setTimeout(wait,20);wait();})`);
      const press=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await new Promise(resolve=>setTimeout(resolve,100));};
      const step=code=>win.webContents.executeJavaScript(`(async()=>{
        const assert=(condition,message)=>{if(!condition)throw Error(message);};
        const wait=async(predicate,message)=>{const start=Date.now();while(!predicate()){if(Date.now()-start>5000)throw Error(message);await new Promise(resolve=>setTimeout(resolve,20));}};
        const tick=()=>new Promise(resolve=>setTimeout(resolve,60));
        const editor=()=>document.querySelector('.notes-text-editor');
        const textNode=(text)=>{const walker=document.createTreeWalker(editor(),NodeFilter.SHOW_TEXT);while(walker.nextNode())if(walker.currentNode.data.includes(text))return walker.currentNode;};
        const select=(node,start,end)=>{const range=document.createRange();range.setStart(node,start);range.setEnd(node,end);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);};
        const clip=type=>{const transfer=new DataTransfer();editor().dispatchEvent(new ClipboardEvent(type,{clipboardData:transfer,bubbles:true,cancelable:true}));return transfer;};
        const setValue=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
        const button=(root,text)=>[...root.querySelectorAll('button')].find(item=>item.textContent===text);
        ${code}
      })()`);

      // Ctrl+A selects the current line first, then the whole memo.
      await step(`
        editor().focus();document.execCommand('insertText',false,'첫 줄');document.execCommand('insertParagraph');document.execCommand('insertText',false,'둘째 줄');
        await tick();assert(editor().children.length>=1&&memoText==='첫 줄\\n둘째 줄','Memo lines were not typed: '+JSON.stringify(memoText));
      `);
      await press('A',['control']);
      await step(`assert(getSelection().toString()==='둘째 줄','First Ctrl+A did not select only the current line: '+JSON.stringify(getSelection().toString()));`);
      await press('A',['control']);
      await step(`const all=getSelection().toString();assert(all.includes('첫 줄')&&all.includes('둘째 줄'),'Second Ctrl+A did not select the whole memo');`);

      // Copy inside one checklist line takes only the text; a multi-line copy keeps the checklist.
      await step(`const node=textNode('둘째');select(node,0,0);`);
      await press('4',['control','shift']);
      await step(`
        await wait(()=>editor().querySelector('.notes-checklist-item'),'Checklist was not applied');
        const node=textNode('둘째');select(node,1,node.data.length);
        const inLine=clip('copy').getData('application/x-planer-note');
        assert(inLine==='째 줄','In-line copy kept the line block: '+JSON.stringify(inLine));
        const range=document.createRange();range.selectNodeContents(editor());getSelection().removeAllRanges();getSelection().addRange(range);
        assert(clip('copy').getData('application/x-planer-note').includes('checklist'),'Multi-line copy lost the checklist block');
      `);
      // Cutting a whole line's text inside the line keeps the (now empty) line.
      await step(`
        const node=textNode('둘째');select(node,0,node.data.length);
        const cut=clip('cut');assert(cut.getData('text/plain')==='둘째 줄','Cut did not copy the line text');
        await tick();
        assert(!memoText.includes('둘째')&&memoText.includes('첫 줄'),'Cut did not remove only the selected text');
        assert(editor().querySelector('.notes-checklist-item'),'Cutting the line text removed the checklist line itself');
      `);

      // Backspace on the empty first line moves into the title and keeps later lines.
      await step(`
        setMemoText('\\n아래 본문');
        await wait(()=>editor().firstElementChild?.firstChild?.nodeName==='BR','Saved blank line was not loaded');
        editor().focus();select(editor().firstElementChild,0,0);
      `);
      await press('Backspace');
      await step(`
        const title=document.querySelector('.notes-title-input');
        assert(document.activeElement===title&&title.selectionStart===title.value.length&&title.selectionEnd===title.value.length,
          'Backspace did not put the caret at the end of the title');
        assert(memoText==='아래 본문'&&editor().firstElementChild?.textContent==='아래 본문','Backspace did not remove only the first line');
        editor().focus();select(textNode('아래 본문'),0,0);
      `);
      await press('Backspace');
      await step(`
        assert(document.activeElement===editor()&&memoText==='아래 본문','Nonempty first line moved the caret to the title');
        setMemoText('');await wait(()=>!editor().hasChildNodes(),'Empty memo did not load');
        editor().focus();select(editor(),0,0);
      `);
      await press('Backspace');
      await step(`assert(document.activeElement===document.querySelector('.notes-title-input')&&memoText==='','Backspace in the empty body did not focus the title');`);

      // Activity colors: planner tab only, pick a chip then a color; the add form is hidden meanwhile.
      await step(`
        const study=document.querySelector('#activities'),control=document.querySelector('#control');
        assert(!button(control,'색상 변경'),'Control tab shows the activity color button');
        button(study,'색상 변경').click();await tick();
        assert(!study.querySelector('.act-add-form')&&study.querySelector('.act-color-hint')?.textContent==='색상을 바꿀 활동을 누르세요.','Color mode did not replace the add form');
        assert(button(study,'✎').disabled,'Reordering stays available in color mode');
        const chip=()=>[...study.querySelectorAll('.act-chip-start')].find(item=>item.textContent==='운동');
        chip().click();await tick();
        assert(chip().getAttribute('aria-pressed')==='true'&&chip().closest('.act-chip').classList.contains('act-chip-color-target'),'Chosen activity is not marked');
        assert(study.querySelector('.act-color-name').textContent==='운동 색상','Color panel does not name the chosen activity');
        study.querySelector('[aria-label="#f97316 (현재 색상)"]').click();await tick();
        assert(colorWrites.length===0,'Picking the current color wrote a change');
        study.querySelector('[aria-label="#22c55e"]').click();
        await wait(()=>colorWrites.length===1&&chip().closest('.act-chip').style.color==='rgb(34, 197, 94)','New color was not saved and shown');
        assert(colorWrites[0][0]==='b'&&colorWrites[0][1]==='#22c55e','Wrong activity color write');
        button(study,'완료').click();await tick();
        assert(study.querySelector('.act-add-form')&&chip().getAttribute('aria-pressed')===null,'Leaving color mode did not restore the add form');
      `);

      // Todos: edit title and due date inline, Escape cancels, failures keep the editor open.
      await step(`
        const list=document.querySelector('#todos');
        list.querySelector('[aria-label="보고서 수정"]').click();await tick();
        const form=list.querySelector('.task-edit-form');assert(form,'Edit form did not open');
        setValue(form.querySelector('.task-edit-title'),'  보고서 제출  ');setValue(form.querySelector('[aria-label="마감일"]'),'');
        button(form,'저장').click();
        await wait(()=>!list.querySelector('.task-edit-form')&&[...list.querySelectorAll('.task-title')].some(item=>item.textContent==='보고서 제출'),'Edited todo was not saved');
        assert(JSON.stringify(todoUpdates)===JSON.stringify([{id:'t1',title:'보고서 제출',dueDate:null}]),'Wrong todo update: '+JSON.stringify(todoUpdates));
        list.querySelector('[aria-label="장보기 수정"]').click();await tick();
        list.querySelector('.task-edit-form').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();
        assert(!list.querySelector('.task-edit-form')&&todoUpdates.length===1,'Escape did not cancel editing');
        list.querySelector('[aria-label="장보기 수정"]').click();await tick();
        button(list.querySelector('.task-edit-form'),'저장').click();await tick();
        assert(!list.querySelector('.task-edit-form')&&todoUpdates.length===1,'Saving an unchanged todo wrote an update');
        globalThis.failTodoUpdate=true;
        list.querySelector('[aria-label="장보기 수정"]').click();await tick();
        setValue(list.querySelector('.task-edit-title'),'장보기 2');button(list.querySelector('.task-edit-form'),'저장').click();
        await wait(()=>list.querySelector('.task-edit-error'),'Failed todo update showed no error');
        assert(list.querySelector('.task-edit-form'),'Failed todo update closed the editor');
        list.querySelector('[aria-label="장보기 완료 후 삭제"]')===null||assert(false,'Editing row still shows the checkbox');
      `);
      console.log(JSON.stringify({lineThenNote:true,inLineCopy:true,lineCutKeepsLine:true,emptyFirstLineToTitle:true,activityColor:true,controlHidden:true,todoEdit:true,todoCancel:true,todoFailure:true}));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
