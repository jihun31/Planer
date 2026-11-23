const fs=require('node:fs'),path=require('node:path');
if(!process.versions.electron){
  (async()=>{
    const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
    const root=path.resolve(__dirname,'..'),temporary=path.join(root,'.tmp');fs.mkdirSync(temporary,{recursive:true});
    const profile=fs.mkdtempSync(path.join(temporary,'note-list-tools-'));
    const server=await createServer({configFile:false,root,cacheDir:path.join(profile,'vite-cache'),plugins:[react()],
      optimizeDeps:{entries:['tests/fixtures/note-checklist.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.tmp/**','**/local-data/**']}},clearScreen:false});
    try{
      await server.listen();const env={...process.env,PLANER_LIST_TOOLS_PROFILE:profile,PLANER_LIST_TOOLS_URL:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/note-checklist.html`};delete env.ELECTRON_RUN_AS_NODE;
      const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'}),timeout=setTimeout(()=>child.kill(),60000);
      process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code??1));child.once('error',reject);});clearTimeout(timeout);
    }finally{await server.close();if(path.dirname(profile)===temporary&&path.basename(profile).startsWith('note-list-tools-'))fs.rmSync(profile,{recursive:true,force:true});}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}else{
  const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.PLANER_LIST_TOOLS_PROFILE);app.disableHardwareAcceleration();
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    const js=code=>win.webContents.executeJavaScript(code);
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const press=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Enter')win.webContents.sendInputEvent({type:'char',keyCode:'\r',modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await wait(60);};
    const type=async value=>{await win.webContents.insertText(value);await wait(40);};
    // Hidden windows ignore synthetic mouse moves from sendInputEvent; the DevTools protocol delivers them.
    let pressed=false;
    const mouse=async(kind,x,y)=>{
      if(kind==='mouseDown')pressed=true;
      const type={mouseMove:'mouseMoved',mouseDown:'mousePressed',mouseUp:'mouseReleased'}[kind];
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,x:Math.round(x),y:Math.round(y),
        button:kind==='mouseMove'&&!pressed?'none':'left',buttons:pressed?1:0,clickCount:kind==='mouseMove'?0:1});
      if(kind==='mouseUp')pressed=false;await wait(40);
    };
    const html=`document.querySelector('.notes-text-editor').innerHTML`;
    const check=async(condition,message)=>{if(!await js(condition))throw Error(message+': '+await js(html));};
    const reset=async()=>{await js(`document.querySelector('#reset').click()`);await wait(60);await js(`document.querySelector('.notes-text-editor').focus()`);};
    const setContent=content=>js(`(()=>{const root=document.querySelector('.notes-text-editor');root.innerHTML=${JSON.stringify(content)};root.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const putCaret=(selector,atEnd=false)=>js(`(()=>{const root=document.querySelector('.notes-text-editor'),node=root.querySelector(${JSON.stringify(selector)});root.focus();const range=document.createRange();range.selectNodeContents(node);range.collapse(${!atEnd});getSelection().removeAllRanges();getSelection().addRange(range);})()`);
    const rows=selector=>js(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(item=>[...item.childNodes].filter(node=>!['UL','OL','BUTTON'].includes(node.nodeName)).map(node=>node.textContent).join(''))`);
    const reopen=async()=>{await js(`document.querySelector('#reopen').click()`);await wait(70);};
    try{
      await win.loadURL(process.env.PLANER_LIST_TOOLS_URL);
      win.webContents.debugger.attach('1.3');
      await js(`new Promise(resolve=>{const wait=()=>document.querySelector('.notes-text-editor')?resolve():setTimeout(wait,20);wait();})`);

      // Slash menu: text that only starts with "/" closes the menu; initial consonants find blocks.
      await reset();await type('/');
      await check(`!!document.querySelector('.notes-slash-menu')`,'Slash alone did not open the block menu');
      await type('2학기 과제');
      await check(`!document.querySelector('.notes-slash-menu')`,'The slash menu stayed open without a matching block');
      await reset();await type('/ㅊㅋ');
      await check(`document.querySelector('.notes-slash-menu [role="option"]')?.textContent.includes('체크리스트')`,'Initial consonants did not find the checklist block');
      await press('Enter');
      await check(`!!document.querySelector('.notes-text-editor li[data-note-checked]')`,'Choosing the consonant match did not create a checklist');
      await reset();await type('/체크');
      await check(`!!document.querySelector('.notes-slash-menu')`,'A partial block name did not keep the menu open');
      await press('Backspace');await press('Backspace');await type('xyz');
      await check(`!document.querySelector('.notes-slash-menu')`,'The menu reappeared for a non-matching query');
      await press('Backspace');await press('Backspace');await press('Backspace');await type('인용');
      await check(`!!document.querySelector('.notes-slash-menu')`,'The menu did not come back after fixing the query');

      // Markdown shortcuts and numbered list start.
      await reset();await type('##');await press('Space');
      await check(`!!document.querySelector('.notes-text-editor h3')`,'## + Space did not make a heading');
      await press('Z',['control']);
      await check(`!document.querySelector('.notes-text-editor h3')&&document.querySelector('.notes-text-editor').textContent==='## '`,'Undo did not restore the literal ## prefix');
      await reset();await type('##');await press('Space');await type('큰 제목');
      await check(`document.querySelector('.notes-text-editor h3')?.textContent==='큰 제목'`,'Typing after ## + Space left the heading');
      await reset();await type('>');await press('Space');await type('인용문');
      await check(`document.querySelector('.notes-text-editor blockquote')?.textContent==='인용문'`,'> + Space did not make a quote');
      await reset();await type('-');await press('Space');await type('글머리');await press('Enter');await type('##');await press('Space');
      await check(`!document.querySelector('.notes-text-editor h3')`,'## inside a list item replaced the list item');
      await reset();await type('5.');await press('Space');await type('다섯');await press('Enter');await type('여섯');
      await check(`document.querySelector('.notes-text-editor ol')?.getAttribute('start')==='5'&&document.querySelectorAll('.notes-text-editor ol>li').length===2`,'5. + Space did not start a numbered list at 5');
      await reopen();
      await check(`document.querySelector('.notes-text-editor ol')?.getAttribute('start')==='5'&&document.querySelector('.notes-text-editor ol>li:nth-child(2)')?.textContent==='여섯'`,'The start number changed after reopening');

      // Alt+Shift+Up/Down moves rows with their sub-items.
      await setContent('<ul><li>가</li><li>나<ul><li>나-하위</li></ul></li><li>다</li></ul>');
      await putCaret('ul > li:first-child',true);
      const beforeMove=await js('checklistText');
      await press('Down',['alt','shift']);
      if(JSON.stringify(await rows('.notes-text-editor > ul > li'))!==JSON.stringify(['나','가','다']))throw Error('Alt+Shift+Down did not move the row: '+await js(html));
      await check(`document.querySelector('.notes-text-editor > ul > li:first-child > ul > li')?.textContent==='나-하위'`,'The sub-item did not move with its row');
      await type('!');
      await check(`document.querySelector('.notes-text-editor > ul > li:nth-child(2)')?.textContent==='가!'`,'The caret did not stay in the moved row');
      await press('Backspace');await press('Up',['alt','shift']);await press('Up',['alt','shift']);
      if(JSON.stringify(await rows('.notes-text-editor > ul > li'))!==JSON.stringify(['가','나','다']))throw Error('Alt+Shift+Up did not move the row back: '+await js(html));
      await setContent('<ul><li>가</li><li>나<ul><li>나-하위</li></ul></li><li>다</li></ul>');
      await putCaret('ul > li:first-child',true);await press('Down',['alt','shift']);await press('Z',['control']);
      await check(`checklistText===${JSON.stringify(beforeMove)}`,'Undo did not restore the order');

      // Checked rows move below their siblings and come back when unchecked.
      await setContent('<ul><li data-note-checked="false"><span class="notes-checklist-text">하나</span></li><li data-note-checked="false"><span class="notes-checklist-text">둘</span></li><li data-note-checked="true"><span class="notes-checklist-text">셋</span></li></ul>');
      await js(`document.querySelector('.notes-text-editor li:first-child [data-note-checkbox]').click()`);await wait(50);
      if(JSON.stringify(await js(`[...document.querySelectorAll('.notes-text-editor li')].map(item=>item.textContent+(item.dataset.noteChecked==='true'?'✓':''))`))!==JSON.stringify(['둘','셋✓','하나✓']))throw Error('Checking did not move the row to the bottom: '+await js(html));
      await js(`document.querySelector('.notes-text-editor li:last-child [data-note-checkbox]').click()`);await wait(50);
      if(JSON.stringify(await js(`[...document.querySelectorAll('.notes-text-editor li')].map(item=>item.textContent+(item.dataset.noteChecked==='true'?'✓':''))`))!==JSON.stringify(['둘','하나','셋✓']))throw Error('Unchecking did not move the row above the checked rows: '+await js(html));
      await reopen();
      await check(`document.querySelector('.notes-text-editor li:nth-child(2)')?.textContent==='하나'`,'The checklist order was not saved');

      // Converting only the selected rows keeps depth and sub-items.
      await setContent('<ul><li>하나</li><li>둘<ul><li>둘-하위</li></ul></li><li>셋</li></ul>');
      await js(`(()=>{const root=document.querySelector('.notes-text-editor'),item=root.querySelector('ul>li:nth-child(2)');root.focus();const range=document.createRange();range.selectNodeContents(item.firstChild);getSelection().removeAllRanges();getSelection().addRange(range);})()`);
      await wait(80);
      await js(`document.querySelector('[aria-label="블록 유형 변경"]').click()`);await wait(30);
      await js(`[...document.querySelectorAll('[role="menuitem"]')].find(button=>button.textContent.includes('숫자 목록')).click()`);await wait(50);
      await check(`[...document.querySelector('.notes-text-editor').children].map(node=>node.nodeName).join()==='UL,OL,UL'&&document.querySelector('.notes-text-editor > ol > li > ul > li')?.textContent==='둘-하위'&&document.querySelector('.notes-text-editor > ul:last-child > li')?.textContent==='셋'`,'Converting one row changed other rows or lost its sub-items');
      await reopen();
      await check(`[...document.querySelector('.notes-text-editor').children].map(node=>node.nodeName).join()==='UL,OL,UL'`,'The converted row changed after reopening');
      await setContent('<ul><li>하나</li><li>둘<ul><li>둘-하위</li></ul></li><li>셋</li></ul>');
      await js(`(()=>{const root=document.querySelector('.notes-text-editor'),items=root.querySelectorAll('li');root.focus();const range=document.createRange();range.setStart(items[0].firstChild,0);range.setEnd(items[3].firstChild,1);getSelection().removeAllRanges();getSelection().addRange(range);})()`);
      await wait(80);
      await js(`document.querySelector('[aria-label="블록 유형 변경"]').click()`);await wait(30);
      await js(`[...document.querySelectorAll('[role="menuitem"]')].find(button=>button.textContent.includes('체크리스트')).click()`);await wait(50);
      await check(`document.querySelectorAll('.notes-text-editor li[data-note-checked]').length===4&&document.querySelector('.notes-text-editor > ul > li:nth-child(2) > ul > li')?.textContent==='둘-하위'`,'Converting several rows to a checklist lost rows or depth');
      await press('Z',['control']);
      await check(`!document.querySelector('.notes-text-editor li[data-note-checked]')`,'Undo did not revert the list conversion');

      // Dragging the handle moves the row (and nests it when dropped to the right).
      await setContent('<ul><li>가</li><li>나</li><li>다</li></ul>');
      const rect=index=>js(`(()=>{const r=document.querySelectorAll('.notes-text-editor li')[${index}].getBoundingClientRect();return {left:r.left,top:r.top,bottom:r.bottom};})()`);
      let target=await rect(2);
      await mouse('mouseMove',target.left+20,target.top+8);
      await check(`!!document.querySelector('.notes-list-handle')`,'Hovering a list row did not show its handle');
      let handle=await js(`(()=>{const r=document.querySelector('.notes-list-handle').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      const first=await rect(0);
      await mouse('mouseDown',handle.x,handle.y);await mouse('mouseMove',handle.x,handle.y-20);await mouse('mouseMove',handle.x,first.top+3);
      await check(`!!document.querySelector('.notes-drop-indicator')`,'Dragging did not show where the row will land');
      await mouse('mouseUp',handle.x,first.top+3);
      if(JSON.stringify(await rows('.notes-text-editor li'))!==JSON.stringify(['다','가','나']))throw Error('Dragging the handle did not move the row: '+await js(html));
      await press('Z',['control']);
      if(JSON.stringify(await rows('.notes-text-editor li'))!==JSON.stringify(['가','나','다']))throw Error('Undo did not restore the dragged row: '+await js(html));
      target=await rect(2);
      await mouse('mouseMove',target.left+20,target.top+8);
      handle=await js(`(()=>{const r=document.querySelector('.notes-list-handle').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      const second=await rect(0);
      await mouse('mouseDown',handle.x,handle.y);await mouse('mouseMove',handle.x+60,handle.y-30);await mouse('mouseMove',second.left+80,second.bottom-4);
      await mouse('mouseUp',second.left+80,second.bottom-4);
      await check(`document.querySelector('.notes-text-editor > ul > li:first-child > ul > li')?.textContent==='다'&&document.querySelectorAll('.notes-text-editor > ul > li').length===2`,'Dropping to the right did not nest the row');

      // Plain-text lists are pasted as lists, and copied lists keep their markers.
      await reset();
      await js(`(()=>{const data=new DataTransfer();data.setData('text/plain','장보기\\n- 우유\\n  - 저지방\\n[ ] 빵\\n3. 셋째');document.querySelector('.notes-text-editor').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`);
      await wait(60);
      await check(`document.querySelector('.notes-text-editor ul ul li')?.textContent==='저지방'&&document.querySelector('.notes-text-editor li[data-note-checked="false"]')?.textContent==='빵'&&document.querySelector('.notes-text-editor ol')?.getAttribute('start')==='3'`,'A pasted plain-text list did not become list rows');
      const copied=await js(`(()=>{const root=document.querySelector('.notes-text-editor'),range=document.createRange();range.selectNodeContents(root);getSelection().removeAllRanges();getSelection().addRange(range);const data=new DataTransfer();root.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return data.getData('text/plain');})()`);
      if(copied!=='장보기\n- 우유\n  - 저지방\n- [ ] 빵\n3. 셋째')throw Error('Copied list text lost its markers: '+JSON.stringify(copied));

      console.log(JSON.stringify({slashNoMatchCloses:true,slashChoseong:true,headingShortcut:true,quoteShortcut:true,numberedStart:true,altShiftMove:true,checkedRowsSink:true,rowConversion:true,handleDrag:true,handleNest:true,listPaste:true,listCopy:true}));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
