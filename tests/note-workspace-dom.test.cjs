const fs=require('node:fs');
const path=require('node:path');
if(!process.versions.electron){
  (async()=>{
    const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
    const temporary=path.resolve(__dirname,'../.tmp');fs.mkdirSync(temporary,{recursive:true});
    const profile=fs.mkdtempSync(path.join(temporary,'note-workspace-test-'));
    const server=await createServer({configFile:false,root:path.resolve(__dirname,'..'),cacheDir:path.join(profile,'vite-cache'),plugins:[react()],
      optimizeDeps:{entries:['tests/fixtures/note-workspace.html']},
      server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.tmp/**','**/local-data/**']}},clearScreen:false});
    try{
      await server.listen();
      const env={...process.env,PLANER_NOTE_TEST_PROFILE:profile,PLANER_NOTE_TEST_URL:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/note-workspace.html`};
      delete env.ELECTRON_RUN_AS_NODE;
      const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'});
      const timeout=setTimeout(()=>child.kill(),45000);
      process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code??1));child.once('error',reject);});
      clearTimeout(timeout);
    }finally{
      await server.close();
      if(path.dirname(profile)===temporary&&path.basename(profile).startsWith('note-workspace-test-'))fs.rmSync(profile,{recursive:true,force:true});
    }
  })().catch(error=>{console.error(error);process.exitCode=1;});
}else{
  const {app,BrowserWindow}=require('electron');
  app.setPath('userData',process.env.PLANER_NOTE_TEST_PROFILE);app.disableHardwareAcceleration();
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:1280,height:850,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    try{
      await win.loadURL(process.env.PLANER_NOTE_TEST_URL);
      const result=await win.webContents.executeJavaScript(`(async()=>{
        const assert=(value,message)=>{if(!value)throw Error(message);};
        const wait=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>7000)throw Error('UI timed out');await new Promise(resolve=>setTimeout(resolve,20));}};
        const items=()=>[...document.querySelectorAll('.notes-list-item')];
        const more=()=>document.querySelector('.notes-load-more');
        await wait(()=>items().length===20);
        assert(noteTestReads[0]===20,'Initial view downloaded more than twenty notes');
        const firstEditor=document.querySelector('textarea[aria-label="note-0 본문"]');
        firstEditor.value='저장 전 작성 내용';
        more().click();await wait(()=>items().length===40);assert(noteTestReads[1]===20,'More fetched preceding notes again');
        more().click();await wait(()=>items().length===45);assert(!more(),'More remains after the last page');
        const input=document.querySelector('.notes-search');
        const search=value=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
        search('검색 대상');await wait(()=>items().length===1&&items()[0].textContent.includes('오래된 검색 대상'));
        items()[0].click();await wait(()=>document.querySelector('textarea[aria-label="note-44 본문"]'));
        search('');await wait(()=>items().length===20);
        assert(document.querySelector('textarea[aria-label="note-44 본문"]').parentElement.hidden===false,'Clearing search closed the selected older note');
        [...document.querySelectorAll('.notes-folder-button')].find(button=>button.textContent.includes('공부')).click();
        await wait(()=>items().length===12);assert(!more(),'Folder with twelve notes should be complete');
        assert(document.contains(firstEditor)&&firstEditor.value==='저장 전 작성 내용','Folder changes discarded the mounted draft');
        const subtitle=document.createElement('p');subtitle.className='calendar-muted calendar-subtitle';
        subtitle.innerHTML='<span class="calendar-summary">이번 달 일정 7개</span><span>날짜를 눌러 일정 추가</span>';document.body.append(subtitle);
        const a=subtitle.children[0].getBoundingClientRect(),b=subtitle.children[1].getBoundingClientRect();
        const calendarGap=b.left-a.right;assert(calendarGap>=7&&calendarGap<=9,'Calendar summary retains excess blank space');
        return {initial:20,pages:[20,20,5],wholeTitleSearch:true,draftsRetained:true,calendarGap};
      })()`);
      console.log(JSON.stringify(result));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
