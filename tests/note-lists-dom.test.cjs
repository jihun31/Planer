const fs=require('node:fs'),path=require('node:path');
if(!process.versions.electron){
  (async()=>{
    const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
    const root=path.resolve(__dirname,'..'),temporary=path.join(root,'.tmp');fs.mkdirSync(temporary,{recursive:true});
    const profile=fs.mkdtempSync(path.join(temporary,'note-lists-'));
    const server=await createServer({configFile:false,root,cacheDir:path.join(profile,'vite-cache'),plugins:[react()],
      optimizeDeps:{entries:['tests/fixtures/note-checklist.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.tmp/**','**/local-data/**']}},clearScreen:false});
    try{
      await server.listen();const env={...process.env,PLANER_LISTS_PROFILE:profile,PLANER_LISTS_URL:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/note-checklist.html`};delete env.ELECTRON_RUN_AS_NODE;
      const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'}),timeout=setTimeout(()=>child.kill(),60000);
      process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code??1));child.once('error',reject);});clearTimeout(timeout);
    }finally{await server.close();if(path.dirname(profile)===temporary&&path.basename(profile).startsWith('note-lists-'))fs.rmSync(profile,{recursive:true,force:true});}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}else{
  const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.PLANER_LISTS_PROFILE);app.disableHardwareAcceleration();
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    const js=code=>win.webContents.executeJavaScript(code);
    const press=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Enter')win.webContents.sendInputEvent({type:'char',keyCode:'\r',modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await new Promise(resolve=>setTimeout(resolve,60));};
    const type=value=>win.webContents.insertText(value);
    const check=async(condition,message)=>{if(!await js(condition))throw Error(message+': '+await js(`document.querySelector('.notes-text-editor').innerHTML`));};
    const reset=async()=>{await js(`document.querySelector('#reset').click()`);await new Promise(resolve=>setTimeout(resolve,60));await js(`document.querySelector('.notes-text-editor').focus()`);};
    try{
      await win.loadURL(process.env.PLANER_LISTS_URL);
      await js(`new Promise(resolve=>{const wait=()=>document.querySelector('.notes-text-editor')?resolve():setTimeout(wait,20);wait();})`);
      await js(`globalThis.activeListItem=()=>{const node=getSelection().anchorNode;return (node.nodeType===1?node:node.parentElement).closest('li');};true;`);
      await reset();await type('1.');await press('Space');
      await check(`!!document.querySelector('.notes-text-editor ol')`,'Automatic numbering was not created');
      await press('Z',['control']);
      await check(`!document.querySelector('.notes-text-editor li')&&document.querySelector('.notes-text-editor').textContent==='1. '`,'Undo did not restore the literal numbered prefix and space');
      await press('Z',['control','shift']);
      await check(`!!activeListItem()&&activeListItem().parentElement.nodeName==='OL'`,'Redo did not restore automatic numbering and its caret');
      await press('Z',['control']);await type('숫자를 텍스트로 사용');
      await check(`!document.querySelector('.notes-text-editor li')&&document.querySelector('.notes-text-editor').textContent==='1. 숫자를 텍스트로 사용'`,'Typing after undo converted back to a numbered list or misplaced the caret');
      await reset();await type('-');await press('Space');await type('상위 목록');await press('Enter');await press('Enter');
      await type('1.');await press('Space');await type('번호 하위 항목');
      await check(`!document.querySelector('.notes-text-editor ul ol')`,'Separate lists unexpectedly nested before Tab');
      await press('Tab');
      await check(`document.querySelector('.notes-text-editor ul>li>ol>li')?.textContent==='번호 하위 항목'`,'First numbered item did not join the preceding bullet list');
      await type(' 계속');
      await check(`document.querySelector('.notes-text-editor ul>li>ol>li')?.textContent==='번호 하위 항목 계속'`,'Nesting moved the caret away from the numbered item');
      await js(`(async()=>{const {readNoteEditor}=await import('/src/features/notes/noteEditorDom.mjs');const {noteRuns}=await import('/src/features/notes/noteRichText.mjs');if(!noteRuns(checklistText).some(run=>run.block==='numbered'&&run.listDepth===1&&run.text.includes('번호 하위 항목')))throw Error('Nesting lost numbered-list metadata');const saved=checklistText;document.querySelector('#reopen').click();await new Promise(resolve=>setTimeout(resolve,70));if(readNoteEditor(document.querySelector('.notes-text-editor'))!==saved)throw Error('Nested numbered list changed after reopening');})()`);
      await reset();await type('-');await press('Space');await type('상위');await press('Enter');await press('Enter');await type('1.');await press('Space');
      await press('Tab');await press('Z',['control']);
      await check(`!document.querySelector('.notes-text-editor ul ol')&&!!document.querySelector('.notes-text-editor ol')`,'Undo of joining separate lists failed');
      await press('Z',['control','shift']);
      await check(`!!document.querySelector('.notes-text-editor ul ol>li')`,'Redo of joining separate lists failed');
      await reset();await type('-');await press('Space');await type('가정');await press('Enter');await press('Tab');
      await type('각 투자자는 각자의 원칙을 가지고 있다.');await press('Enter');await type('2. ㅇ');await press('Enter');
      await check(`activeListItem()?.parentElement.parentElement.nodeName==='LI'`,'Screenshot case did not create a nested empty bullet');
      await press('Enter');
      await check(`(()=>{const item=activeListItem();return !!item&&item.parentElement.parentElement.nodeName!=='LI';})()`,'Empty Enter failed to move to the parent list');
      await press('Enter');
      await check(`!activeListItem()`,'Second empty Enter did not leave the list');
      await type('일반 문장');
      await check(`document.querySelector('.notes-text-editor').textContent.includes('각 투자자는 각자의 원칙을 가지고 있다.')&&document.querySelector('.notes-text-editor').textContent.includes('일반 문장')`,'Leaving nested bullets lost text or blocked typing');
      await press('Z',['control']);await press('Z',['control','shift']);
      await reset();await type('1.');await press('Space');await type('첫째');await press('Enter');await type('둘째');await press('Enter');await press('Tab');await type('하위 숫자');await press('Enter');
      await check(`document.querySelectorAll('.notes-text-editor ol').length===2`,'Numbered list shortcut or indent failed');
      await press('Enter');await press('Enter');
      await check(`!activeListItem()`,'Numbered list could not exit through its parent');
      await type('목록 밖');
      await js(`(async()=>{
        const {readNoteEditor}=await import('/src/features/notes/noteEditorDom.mjs');
        const {noteHtml,noteRuns}=await import('/src/features/notes/noteRichText.mjs');
        const root=document.querySelector('.notes-text-editor'),saved=checklistText;
        if(!noteRuns(saved).some(run=>run.block==='numbered'&&run.listDepth===1&&run.text.includes('하위 숫자')))throw Error('Stored numbered list lost its type or depth');
        if(readNoteEditor(root)!==saved)throw Error('Live numbered list differs from saved content');
        document.querySelector('#reopen').click();await new Promise(resolve=>setTimeout(resolve,70));
        const reopened=document.querySelector('.notes-text-editor');
        if(readNoteEditor(reopened)!==saved||reopened.innerHTML!==noteHtml(saved,true))throw Error('Numbered lists changed when reopened');
      })()`);
      await js(`(()=>{const root=document.querySelector('.notes-text-editor'),item=root.querySelector('ol>li');root.focus();const range=document.createRange();range.selectNodeContents(item.firstChild);getSelection().removeAllRanges();getSelection().addRange(range);})()`);
      await new Promise(resolve=>setTimeout(resolve,80));
      await js(`document.querySelector('[aria-label="블록 유형 변경"]').click()`);
      await js(`[...document.querySelectorAll('[role="menuitem"]')].find(button=>button.textContent.includes('글머리 기호 목록')).click()`);
      await check(`document.querySelector('.notes-text-editor').firstElementChild.nodeName==='UL'`,'Numbered list did not convert to bullets');
      await reset();await type('/숫자목록');await press('Enter');
      await check(`!!document.querySelector('.notes-text-editor ol>li')`,'Korean numbered slash command failed');
      await type('보존');await press('Enter');await press('Tab');await press('Backspace');
      await check(`activeListItem()?.parentElement.parentElement.nodeName!=='LI'`,'Backspace on empty nested list did not move up');
      await press('Enter');await check(`!activeListItem()`,'Empty list remained in an Enter/Backspace loop');
      await type('탈출 성공');
      console.log(JSON.stringify({autoNumberedUndoToLiteral:true,autoNumberedRedo:true,joinPrecedingList:true,joinUndoRedo:true,nestedBulletEmptyEnter:true,numberedShortcut:true,numberedNesting:true,numberedPersistence:true,listTypeConversion:true,koreanSlash:true,backspaceExit:true,typingAfterExit:true}));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
