const fs=require('node:fs'),path=require('node:path');
if(!process.versions.electron){
  (async()=>{
    const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
    const root=path.resolve(__dirname,'..'),temporary=path.join(root,'.tmp');fs.mkdirSync(temporary,{recursive:true});
    const profile=fs.mkdtempSync(path.join(temporary,'settings-help-'));
    const stub=path.join(root,'tests/fixtures/schedule-settings-stub.mjs');
    const server=await createServer({configFile:false,root,cacheDir:path.join(profile,'vite-cache'),plugins:[{
      name:'settings-firebase-stub',enforce:'pre',resolveId(source){if(source.endsWith('/features/planner/scheduleSettings'))return stub;},
    },react()],optimizeDeps:{entries:['tests/fixtures/settings-help.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.tmp/**','**/local-data/**']}},clearScreen:false});
    try{
      await server.listen();const env={...process.env,PLANER_SETTINGS_PROFILE:profile,PLANER_SETTINGS_URL:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/settings-help.html`};delete env.ELECTRON_RUN_AS_NODE;
      const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'}),timeout=setTimeout(()=>child.kill(),45000);
      process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code??1));child.once('error',reject);});clearTimeout(timeout);
    }finally{await server.close();if(path.dirname(profile)===temporary&&path.basename(profile).startsWith('settings-help-'))fs.rmSync(profile,{recursive:true,force:true});}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}else{
  const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.PLANER_SETTINGS_PROFILE);app.disableHardwareAcceleration();
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    try{
      await win.loadURL(process.env.PLANER_SETTINGS_URL);
      const result=await win.webContents.executeJavaScript(`(async()=>{try{
        const assert=(value,message)=>{if(!value)throw Error(message);};
        const tick=()=>new Promise(resolve=>setTimeout(resolve,60));
        const wait=async(predicate,message='UI timed out')=>{const start=Date.now();while(!predicate()){if(Date.now()-start>5000)throw Error(message);await tick();}};
        const dialog=()=>document.querySelector('dialog.schedule-settings');
        const text=()=>dialog().textContent;
        const toggles=()=>[...dialog().querySelectorAll('.setting-help-toggle')];
        const notes=['직전 기록 이후의 빈 시간','배지를 누르면','쉬어 갈 때라고','휴식할지 묻는 창','화살표로 순서를','달력에 표시할','오늘부터 적용'];
        await wait(()=>dialog()&&toggles().length>0,'Settings dialog did not render');
        assert(toggles().length===6,'Expected 6 help buttons, got '+toggles().length);
        assert(notes.every(note=>!text().includes(note)),'A description is visible before pressing ?');

        // 체크박스 label 안의 ? 버튼은 설명만 펼치고 체크 상태를 바꾸지 않는다.
        const label=toggles()[0].closest('label'),checkbox=label.querySelector('input[type="checkbox"]'),before=checkbox.checked;
        toggles()[0].click();await tick();
        assert(text().includes(notes[0]),'? did not show the study gap description');
        assert(checkbox.checked===before,'? toggled the checkbox');
        assert(toggles()[0].getAttribute('aria-expanded')==='true','aria-expanded not true after opening');
        assert(!text().includes(notes[1]),'Opening one description opened another');
        toggles()[0].click();await tick();
        assert(!text().includes(notes[0]),'Second ? click did not hide the description');

        // 시간 범위 ? 는 범위 설명 두 줄을 함께 펼친다.
        toggles()[5].click();await tick();
        assert(text().includes(notes[5])&&text().includes(notes[6]),'Calendar ? did not show range descriptions');

        // 문구 수정 중에는 설명을 고칠 수 있게 모두 펼치고 ? 버튼은 감춘다.
        await wait(()=>!dialog().querySelector('.copy-edit-button').disabled,'Copy edit unavailable');
        dialog().querySelector('.copy-edit-button').click();await tick();
        assert(toggles().length===0,'? buttons remain while editing copy');
        const editors=[...dialog().querySelectorAll('.editable-copy-field')].map(field=>field.textContent).join(' ');
        assert(notes.every(note=>editors.includes(note)),'A description is not editable while editing copy');
        return {hiddenByDefault:true,toggleShowsOne:true,checkboxUnchanged:true,editShowsAll:true};
      }catch(error){return {failure:String(error&&error.stack||error)};}})()`);
      if(result.failure)throw Error(result.failure);
      console.log(JSON.stringify(result));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
