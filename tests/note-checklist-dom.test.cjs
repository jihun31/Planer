const fs=require('node:fs'),path=require('node:path');
if(!process.versions.electron){
  (async()=>{
    const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
    const root=path.resolve(__dirname,'..'),temporary=path.join(root,'.tmp');fs.mkdirSync(temporary,{recursive:true});
    const profile=fs.mkdtempSync(path.join(temporary,'note-checklist-'));
    const server=await createServer({configFile:false,root,cacheDir:path.join(profile,'vite-cache'),plugins:[react()],
      optimizeDeps:{entries:['tests/fixtures/note-checklist.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.tmp/**','**/local-data/**']}},clearScreen:false});
    try{
      await server.listen();const env={...process.env,PLANER_CHECKLIST_PROFILE:profile,PLANER_CHECKLIST_URL:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/note-checklist.html`};delete env.ELECTRON_RUN_AS_NODE;
      const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'}),timeout=setTimeout(()=>child.kill(),60000);
      process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code??1));child.once('error',reject);});clearTimeout(timeout);
    }finally{await server.close();if(path.dirname(profile)===temporary&&path.basename(profile).startsWith('note-checklist-'))fs.rmSync(profile,{recursive:true,force:true});}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}else{
  const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.PLANER_CHECKLIST_PROFILE);app.disableHardwareAcceleration();
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    try{
      await win.loadURL(process.env.PLANER_CHECKLIST_URL);
      await win.webContents.executeJavaScript(`new Promise(resolve=>{const wait=()=>document.querySelector('.notes-text-editor')?resolve():setTimeout(wait,20);wait();})`);
      const press=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await new Promise(resolve=>setTimeout(resolve,70));};
      await win.webContents.executeJavaScript(`document.querySelector('.notes-text-editor').focus()`);
      await win.webContents.insertText('/todo');await press('Space');
      for(let index=0;index<6;index++){
        for(const chunk of ['연속 ','항목 ',String(index+1)]) await win.webContents.insertText(chunk);
        if(index<5)await press('Enter');
      }
      const typedSnapshot=await win.webContents.executeJavaScript('checklistText');
      await press('Z',['control']);
      if(await win.webContents.executeJavaScript('checklistText')===typedSnapshot)throw Error('Real typed checklist could not undo text input');
      await press('Z',['control','shift']);
      if(await win.webContents.executeJavaScript('checklistText')!==typedSnapshot)throw Error('Real typed checklist could not redo text input');
      await win.webContents.executeJavaScript(`(async()=>{
        const root=document.querySelector('.notes-text-editor'),items=[...root.querySelectorAll('li[data-note-checked]')];
        if(items.length!==6)throw Error('Real typing did not create six checkboxes: '+root.innerHTML);
        for(let index=0;index<items.length;index++){
          if(items[index].querySelector(':scope > .notes-checklist-text')?.textContent!=='연속 항목 '+(index+1))throw Error('Real typing escaped the checkbox text span: '+root.innerHTML);
          items[index].querySelector('button').click();
        }
        await new Promise(resolve=>setTimeout(resolve,70));
        if(items.some(item=>!getComputedStyle(item.querySelector('.notes-checklist-text')).textDecorationLine.includes('line-through')))throw Error('Real typed checklist completion did not strike through every item');
        const saved=checklistText;
        document.querySelector('#reopen').click();await new Promise(resolve=>setTimeout(resolve,70));
        const reopened=[...document.querySelectorAll('.notes-text-editor li[data-note-checked]')];
        if(reopened.length!==6||checklistText!==saved||reopened.some(item=>item.getAttribute('data-note-checked')!=='true'))throw Error('Six sequential checklist items changed after reopening');
        reopened[1].querySelector('button').click();await new Promise(resolve=>setTimeout(resolve,70));
        if(getComputedStyle(reopened[1].querySelector('.notes-checklist-text')).textDecorationLine.includes('line-through'))throw Error('Unchecking did not clear the completion strike');
        document.querySelector('#reset').click();
        await new Promise(resolve=>setTimeout(resolve,70));
      })()`);
      const reset=async()=>{await win.webContents.executeJavaScript(`document.querySelector('#reset').click()`);await new Promise(resolve=>setTimeout(resolve,70));await win.webContents.executeJavaScript(`document.querySelector('.notes-text-editor').focus()`);};
      const assertCaret=async()=>win.webContents.executeJavaScript(`(()=>{
        const root=document.querySelector('.notes-text-editor'),item=root.querySelector('li:last-child'),content=item?.querySelector(':scope > .notes-checklist-text');
        const selection=getSelection(),range=selection.getRangeAt(0);
        // Chromium returns no range rectangle at an empty BR boundary. Its
        // editable text box still supplies the caret's layout position.
        const caret=[...range.getClientRects()].find(rect=>rect.height>0)||content.getBoundingClientRect();
        const checkbox=item.querySelector('button').getBoundingClientRect();
        if(!selection.isCollapsed||!content.contains(range.startContainer)||caret.height<=0||caret.left<checkbox.right+2)throw Error('Empty checklist caret is inside the checkbox instead of its text area: '+JSON.stringify({html:root.innerHTML,anchor:range.startContainer.nodeName,caret:caret.toJSON(),checkbox:checkbox.toJSON()}));
      })()`);
      await reset();await win.webContents.insertText('/todo');await press('Space');await assertCaret();
      await press('Backspace');
      if(await win.webContents.executeJavaScript(`!!document.querySelector('.notes-text-editor [data-note-checkbox]')`))throw Error('Fresh empty checklist needs more than one Backspace');
      await win.webContents.insertText('빈 항목 삭제 후 입력');
      if(await win.webContents.executeJavaScript(`document.querySelector('.notes-text-editor').textContent`)!=='빈 항목 삭제 후 입력')throw Error('Deleting a fresh empty checklist blocked typing');
      await reset();await win.webContents.insertText('/todo');await press('Space');await win.webContents.insertText('보존할 항목');await press('Enter');await assertCaret();
      await press('Backspace');
      if(await win.webContents.executeJavaScript(`document.querySelectorAll('.notes-text-editor [data-note-checkbox]').length`)!==1)throw Error('New empty item was not removed with one Backspace');
      await win.webContents.insertText('독립 문장');
      if(await win.webContents.executeJavaScript(`document.querySelector('.notes-checklist-text').textContent`)!=='보존할 항목')throw Error('Removing an empty item changed the previous checklist');
      await reset();await win.webContents.insertText('/todo');await press('Space');await win.webContents.insertText('abc');
      await press('Backspace');await press('Backspace');await press('Backspace');await assertCaret();await press('Backspace');
      if(await win.webContents.executeJavaScript(`!!document.querySelector('.notes-text-editor [data-note-checkbox]')`))throw Error('Cleared checklist needs more than one Backspace');
      await reset();
      await win.webContents.executeJavaScript(`document.querySelector('.notes-text-editor').focus()`);
      await win.webContents.insertText('/todo');await press('Space');
      for(let index=0;index<4;index++){
        await win.webContents.insertText('삭제할 항목 '+(index+1));
        if(index<3)await press('Enter');
      }
      await win.webContents.executeJavaScript(`(()=>{
        const root=document.querySelector('.notes-text-editor'),texts=root.querySelectorAll('.notes-checklist-text'),range=document.createRange();
        range.selectNodeContents(texts[0]);range.setEnd(texts[3],texts[3].childNodes.length);
        getSelection().removeAllRanges();getSelection().addRange(range);
      })()`);
      const beforeBulkDelete=await win.webContents.executeJavaScript('checklistText');
      await press('Backspace');
      await press('Z',['control']);
      if(await win.webContents.executeJavaScript('checklistText')!==beforeBulkDelete)throw Error('Undo of bulk checklist deletion did not restore the original items');
      await press('Z',['control','shift']);
      if(await win.webContents.executeJavaScript(`document.querySelectorAll('.notes-text-editor [data-note-checkbox]').length`)!==1)throw Error('Bulk deletion retained empty checklist shells');
      await assertCaret();
      await press('Backspace');
      await win.webContents.executeJavaScript(`(()=>{
        const root=document.querySelector('.notes-text-editor');
        if(root.querySelector('[data-note-checkbox]'))throw Error('Bulk deletion followed by Backspace left an orphan checkbox: '+root.innerHTML);
      })()`);
      await win.webContents.insertText('다시 입력');
      await win.webContents.executeJavaScript(`(async()=>{
        const {notePlainText}=await import('/src/features/notes/noteRichText.mjs');
        if(notePlainText(checklistText)!=='다시 입력')throw Error('Typing after bulk deletion was blocked: '+document.querySelector('.notes-text-editor').innerHTML);
        document.querySelector('#reset').click();await new Promise(resolve=>setTimeout(resolve,70));
      })()`);
      const result=await win.webContents.executeJavaScript(`(async()=>{
        const {noteRuns,noteHtml,notePlainText}=await import('/src/features/notes/noteRichText.mjs');
        const {readNoteEditor}=await import('/src/features/notes/noteEditorDom.mjs');
        const assert=(value,message)=>{if(!value)throw Error(message);};
        const tick=()=>new Promise(resolve=>setTimeout(resolve,70));await tick();
        const root=()=>document.querySelector('.notes-text-editor');
        const items=()=>[...root().querySelectorAll('li[data-note-checked]')];
        const caret=(node,end=true)=>{root().focus();const range=document.createRange();range.selectNodeContents(node);range.collapse(!end);getSelection().removeAllRanges();getSelection().addRange(range);};
        const key=async(value,extra={})=>{root().dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...extra}));await tick();};
        const type=async value=>{document.execCommand('insertText',false,value);await tick();};
        caret(root());await type('/todo');await key(' ');
        assert(items().length===1&&items()[0].getAttribute('data-note-checked')==='false','Slash command did not create an unchecked item');
        caret(items()[0].querySelector('.notes-checklist-text'));await type('첫 항목');
        await key('Enter');assert(items().length===2,'Enter did not create the next checkbox');
        await type('둘째 항목');
        items()[0].querySelector('button').click();await tick();
        assert(items()[0].getAttribute('data-note-checked')==='true','Checkbox did not toggle');
        assert(getComputedStyle(items()[0].querySelector('.notes-checklist-text')).textDecorationLine.includes('line-through'),'Completed text is not struck through');
        const checked=checklistText;
        await key('z',{ctrlKey:true});assert(items()[0].getAttribute('data-note-checked')==='false','Undo did not restore completion');
        await key('z',{ctrlKey:true,shiftKey:true});assert(checklistText===checked,'Redo did not restore completion');
        document.querySelector('#reopen').click();await tick();
        assert(items().length===2&&items()[0].getAttribute('data-note-checked')==='true','Reopening lost completion or items');
        assert(readNoteEditor(root())===checklistText,'Saving and reopening changed the document');
        caret(items()[0].querySelector('.notes-checklist-text'),false);await key('Enter');
        assert(items().length===3&&items()[1].getAttribute('data-note-checked')==='false','Split item inherited completion');
        const splitText=notePlainText(checklistText);assert(splitText.includes('첫 항목')&&splitText.includes('둘째 항목'),'Splitting lost text');
        caret(items().at(-1).querySelector('.notes-checklist-text'));await key('Enter');await key('Enter');
        assert(items().length===3&&getSelection().anchorNode.parentElement.closest('li')===null,'Empty Enter did not exit checklist');
        await type('[]');await key(' ');assert(items().length===4,'Markdown checkbox shortcut failed');
        await type('세 번째');await key('Tab');
        assert(noteRuns(checklistText).some(run=>run.text.includes('세 번째')&&run.listDepth===1),'Tab did not retain checklist nesting');
        await key('Tab',{shiftKey:true});
        assert(!noteRuns(checklistText).some(run=>run.text.includes('세 번째')&&run.listDepth),'Shift+Tab did not restore list depth: '+JSON.stringify({html:root().innerHTML,runs:noteRuns(checklistText),selection:getSelection().anchorNode?.parentElement?.outerHTML}));
        const content=items().at(-1).querySelector('.notes-checklist-text');caret(content,false);await key('Backspace');
        assert(items().length===3&&notePlainText(checklistText).includes('세 번째'),'Backspace did not preserve text when leaving a checklist: '+JSON.stringify({html:root().innerHTML,text:notePlainText(checklistText)}));
        caret(root().lastElementChild);await key('4',{ctrlKey:true,shiftKey:true,code:'Digit4'});
        assert(items().length===4,'Checklist keyboard shortcut failed');
        const snapshot=checklistText;document.querySelector('#readonly').click();await tick();
        items()[0].querySelector('button').click();await tick();assert(checklistText===snapshot,'Read-only checkbox changed stored content');
        document.querySelector('#readonly').click();await tick();
        caret(items().at(-1).querySelector('.notes-checklist-text'));
        document.execCommand('bold');await type(' 굵게');document.execCommand('bold');
        const saved=checklistText;root().innerHTML=noteHtml(saved,true);
        assert(noteRuns(readNoteEditor(root())).some(run=>run.bold&&run.text.includes('굵게')),'Checklist lost inline formatting');
        assert(!notePlainText(saved).includes('체크리스트 완료'),'Checkbox controls leaked into saved text');
        const last=items().at(-1).querySelector('.notes-checklist-text');root().focus();
        const range=document.createRange();range.selectNodeContents(last);getSelection().removeAllRanges();getSelection().addRange(range);await tick();
        await key('S',{ctrlKey:true,shiftKey:true,code:'KeyS'});
        assert(noteRuns(checklistText).some(run=>run.strike&&run.text.includes('굵게')),'Strike shortcut did not save the selected text formatting');
        const strikeButton=document.querySelector('[aria-label="취소선"]');
        assert(strikeButton?.getAttribute('aria-pressed')==='true','Strike toolbar does not reflect selected formatting');
        strikeButton.click();await tick();
        assert(!noteRuns(checklistText).some(run=>run.strike),'Strike toolbar did not remove manual strikethrough');
        await key('S',{ctrlKey:true,shiftKey:true,code:'KeyS'});
        const stricken=checklistText;document.querySelector('#reopen').click();await tick();
        assert(checklistText===stricken&&root().querySelector('s,strike'),'Manual strike disappeared after reopening');
        assert(items()[0].getAttribute('data-note-checked')==='true','Manual strike changed checklist completion');
        return {realSequentialInput:6,bulkDelete:true,emptyItemDelete:true,caretOutsideCheckbox:true,typingAfterDelete:true,slash:true,markdown:true,completion:true,undoRedo:true,split:true,emptyExit:true,nesting:true,backspace:true,keyboardShortcut:true,readOnly:true,formattedPersistence:true,manualStrike:true,strikeToolbar:true,strikePersistence:true};
      })()`);
      if(process.env.PLANER_CHECKLIST_SCREENSHOT){await new Promise(resolve=>setTimeout(resolve,200));fs.writeFileSync(process.env.PLANER_CHECKLIST_SCREENSHOT,(await win.webContents.capturePage()).toPNG());}
      console.log(JSON.stringify(result));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
