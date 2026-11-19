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
      await check(`activeListItem()?.hasAttribute('data-note-list-text')`,'First Backspace did not remove the nested marker');
      await press('Backspace');
      await check(`activeListItem()?.textContent==='보존'`,'Second Backspace did not move the caret to the parent');
      await type(' 유지');
      await check(`activeListItem()?.textContent==='보존 유지'`,'Moved caret was not at the end of the parent');

      const setContent=html=>js(`(()=>{
        const root=document.querySelector('.notes-text-editor');
        root.innerHTML=${JSON.stringify(html)};
        root.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      const putCaret=(selector,atEnd=false)=>js(`(()=>{
        const root=document.querySelector('.notes-text-editor'),node=root.querySelector(${JSON.stringify(selector)});
        root.focus();
        const range=document.createRange();range.selectNodeContents(node);range.collapse(${!atEnd});
        getSelection().removeAllRanges();getSelection().addRange(range);
      })()`);
      await setContent('<ul><li><strong>상위</strong><ol><li>앞 번호</li><li><br></li><li>뒤 번호<ul><li>더 깊은 글머리</li></ul></li></ol><ul><li data-note-checked="true"><span class="notes-checklist-text">완료 항목</span></li></ul></li><li>다음 상위</li></ul>');
      await putCaret('ol > li:nth-child(2)');
      const beforeBackspace=await js('checklistText');
      await press('Backspace');
      await check(`getSelection().anchorNode.closest('[data-note-list-content]') && document.querySelector('ol > li:nth-child(2)').matches('[data-note-list-text]')`,'Markerless line lost its editable caret');
      await press('Z',['control']);
      await check(`checklistText===${JSON.stringify(beforeBackspace)} && activeListItem()===document.querySelector('ol > li:nth-child(2)')`,'Undo did not restore the empty nested item and its caret');
      await press('Z',['control','shift']);
      await js(`document.querySelector('#reopen').click()`);
      await new Promise(resolve=>setTimeout(resolve,70));
      await check(`document.querySelector('ol > li:nth-child(2)').matches('[data-note-list-text]')`,'Markerless line was lost after reopening');
      await putCaret('ol > li:nth-child(2) > [data-note-list-content]');
      await type('들여쓴 일반 문장');
      await check(`document.querySelector('ol > li:nth-child(2) > [data-note-list-content]')?.textContent==='들여쓴 일반 문장'`,'Typing after the first Backspace escaped the markerless line');
      await press('Z',['control']);
      await putCaret('ol > li:nth-child(2) > [data-note-list-content]');
      await press('Backspace');
      await check(`activeListItem()?.textContent==='앞 번호' && document.querySelector('ol > li:nth-child(2) > ul > li')?.textContent==='더 깊은 글머리' && document.querySelector('ol + ul > li[data-note-checked="true"]')?.textContent==='완료 항목'`,'Removing a middle item misplaced the caret or changed the following items');

      await setContent('<ul><li>상위<ul><li data-note-checked="true"><span class="notes-checklist-text">글 왼쪽에 요약 넣기</span></li><li data-note-checked="false"><button type="button" class="notes-checkbox" contenteditable="false" data-note-checkbox="true" role="checkbox" aria-checked="false"></button><span class="notes-checklist-text"><br></span></li><li data-note-checked="false"><span class="notes-checklist-text">기업분석 채우기</span></li></ul></li></ul>');
      await putCaret('ul ul > li:nth-child(2) > .notes-checklist-text');
      await press('Backspace');
      await check(`activeListItem()?.matches('[data-note-list-text]')`,'The first Backspace did not leave an editable blank line');
      await press('Backspace');
      await check(`activeListItem()?.textContent==='글 왼쪽에 요약 넣기' && activeListItem().nextElementSibling?.textContent==='기업분석 채우기'`,'The second Backspace moved the caret or removed a different row');
      await type(' 끝');
      await check(`activeListItem()?.matches('[data-note-checked="true"]') && activeListItem().textContent==='글 왼쪽에 요약 넣기 끝' && activeListItem().nextElementSibling?.textContent==='기업분석 채우기'`,'The second Backspace did not move to the preceding checklist line or changed the following line');

      await setContent('<ul><li>상위<ol><li>앞 번호<ul><li>바로 윗줄</li></ul></li></ol><ul><li><br></li><li>그 아래</li></ul></li></ul>');
      await putCaret('ol + ul > li');
      await press('Backspace');await press('Backspace');
      await check(`activeListItem()?.textContent==='바로 윗줄' && document.querySelector('ol + ul > li')?.textContent==='그 아래'`,'The caret skipped a preceding row in a different nested list');

      await setContent('<ul><li>부모<ul><li data-note-checked="false"><span class="notes-checklist-text"><br></span><ol><li>자식 번호</li></ol></li><li>다음 항목</li></ul></li></ul>');
      await putCaret('.notes-checklist-text');
      await press('Backspace');
      await check(`activeListItem()?.matches('[data-note-list-text]') && !document.querySelector('[data-note-checkbox]')`,'First Backspace did not remove the checkbox');
      await press('Backspace');
      await check(`activeListItem()?.firstChild.textContent==='부모' && document.querySelector('li[data-note-list-text="continuation"] > ol > li')?.textContent==='자식 번호' && document.querySelector('ol').parentElement.nextElementSibling?.textContent==='다음 항목'`,'Removing the markerless row displaced its children or siblings');
      await js(`document.querySelector('#reopen').click()`);
      await new Promise(resolve=>setTimeout(resolve,70));
      await check(`document.querySelector('li[data-note-list-text="continuation"] > span').hidden && document.querySelector('li[data-note-list-text="continuation"] > ol > li')?.textContent==='자식 번호'`,'Hidden row and its descendants changed after reopening');

      await setContent('<div>첫 줄</div><ul><li><b>대상</b> 문구<ul><li>하위 보존</li></ul></li><li data-note-checked="true"><span class="notes-checklist-text">체크 유지</span></li></ul><div>마지막 줄</div>');
      await js(`(() => {
        const setData=DataTransfer.prototype.setData;
        DataTransfer.prototype.setData=function(type,value) {
          if (type==='text/plain') globalThis.cutText=value;
          return setData.call(this,type,value);
        };
      })()`);
      await putCaret('li > b');
      await press('A',['control']);
      await check(`getSelection().toString()==='대상 문구'`,'Ctrl+A included text outside the current list line');
      const beforeCut=await js('checklistText');
      await press('X',['control']);
      if(await js('cutText')!=='대상 문구')throw Error('Ctrl+X did not copy only the current list line to the clipboard');
      await check(`document.querySelector('li > ul > li')?.textContent==='하위 보존' && document.querySelector('li[data-note-checked="true"]')?.textContent==='체크 유지' && document.querySelector('.notes-text-editor').lastElementChild.textContent==='마지막 줄' && !document.querySelector('.notes-text-editor').textContent.includes('대상 문구')`,'Ctrl+X altered neighboring or nested blocks');
      await press('Z',['control']);
      await check(`checklistText===${JSON.stringify(beforeCut)}`,'Ctrl+Z did not restore the cut line and formatting');
      await press('Z',['control','shift']);
      await check(`!document.querySelector('.notes-text-editor').textContent.includes('대상 문구') && document.querySelector('li > ul > li')?.textContent==='하위 보존'`,'Redo of the cut changed nested content');

      await putCaret('.notes-checklist-text');
      await press('X',['control']);
      if(await js('cutText')!=='체크 유지')throw Error('Cutting a checked line did not copy its own text');
      // Ctrl+X with only a caret cuts the whole row (a selected-text cut keeps the row; see memo-todo-dom).
      await check(`!document.querySelector('li[data-note-checked="true"]') && document.querySelector('li > ul > li')?.textContent==='하위 보존'`,'Cutting a checklist row left the item or changed a different line');

      await setContent('<div>앞 줄<br><b>중간 줄</b><br>뒤 줄</div><div>다음 블록</div>');
      await putCaret('div > b');
      await press('X',['control']);
      if(await js('cutText')!=='중간 줄')throw Error('Ctrl+X at a caret did not copy the current hard-break line');
      await check(`document.querySelector('.notes-text-editor').textContent==='앞 줄뒤 줄다음 블록'`,'Ctrl+X changed text beyond the hard line breaks');

      await setContent('<div>first</div><div><br></div><div>last</div>');
      await putCaret('.notes-text-editor > div:nth-child(2)');
      await press('X',['control']);
      await check(`[...document.querySelector('.notes-text-editor').children].map(row=>row.textContent).join('|')==='first|last'`,'Ctrl+X left a blank row behind');
      await press('Z',['control']);
      await check(`document.querySelector('.notes-text-editor').children.length===3`,'Undo did not restore the blank row');

      console.log(JSON.stringify({autoNumberedUndoToLiteral:true,autoNumberedRedo:true,joinPrecedingList:true,joinUndoRedo:true,nestedBulletEmptyEnter:true,numberedShortcut:true,numberedNesting:true,numberedPersistence:true,listTypeConversion:true,koreanSlash:true,backspaceExit:true,typingAfterExit:true,middleDeletion:true,markerlessPersistence:true,scopedCut:true}));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
