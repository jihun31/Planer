const fs=require('node:fs'),path=require('node:path');
if(!process.versions.electron){
  (async()=>{
    const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
    const root=path.resolve(__dirname,'..'),temporary=path.join(root,'.tmp');fs.mkdirSync(temporary,{recursive:true});
    const profile=fs.mkdtempSync(path.join(temporary,'timer-switch-'));
    const mock=path.join(root,'tests/fixtures/timer-switch-data.jsx');
    const server=await createServer({configFile:false,root,cacheDir:path.join(profile,'vite-cache'),plugins:[{
      name:'preview-private-data',enforce:'pre',resolveId(source){
        if(['/features/planner/usePlanner','/features/planner/useControl','/features/plans/useDayPlans'].some(suffix=>source.endsWith(suffix)))return mock;
      },
    },react()],optimizeDeps:{entries:['tests/fixtures/timer-switch.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.tmp/**','**/local-data/**']}},clearScreen:false});
    try{
      await server.listen();const env={...process.env,PLANER_PREVIEW_PROFILE:profile,PLANER_PREVIEW_URL:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/timer-switch.html`};delete env.ELECTRON_RUN_AS_NODE;
      const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'}),timeout=setTimeout(()=>child.kill(),60000);
      process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code??1));child.once('error',reject);});clearTimeout(timeout);
    }finally{await server.close();if(path.dirname(profile)===temporary&&path.basename(profile).startsWith('timer-switch-'))fs.rmSync(profile,{recursive:true,force:true});}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}else{
  const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.PLANER_PREVIEW_PROFILE);app.disableHardwareAcceleration();
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:1360,height:980,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
    try{
      await win.loadURL(process.env.PLANER_PREVIEW_URL);
      const result=await win.webContents.executeJavaScript(`(async()=>{
        const assert=(condition,message)=>{if(!condition)throw Error(message);};
        const wait=async(predicate,message='UI timed out')=>{const start=Date.now();while(!predicate()){if(Date.now()-start>8000)throw Error(message);await new Promise(resolve=>setTimeout(resolve,20));}};
        const tick=()=>new Promise(resolve=>setTimeout(resolve,80));
        const study=document.querySelector('#study'),control=document.querySelector('#control');
        const chip=(root,name)=>[...root.querySelectorAll('.act-chip-start')].find(button=>button.textContent===name);
        const floatName=()=>document.querySelector('.float-timer .ft-name')?.textContent;
        const prompt=()=>document.querySelector('dialog.timer-switch-dialog[open]');
        const stop=()=>document.querySelector('.float-timer .ft-stop').click();
        await wait(()=>chip(study,'강의')&&chip(control,'유튜브'));

        // 기본은 꺼짐: 정지해도 다음 활동 창이 뜨지 않는다.
        chip(study,'강의').click();await wait(()=>floatName()==='강의','Study timer did not start');
        stop();await wait(()=>timerSwitchSaves.length===1,'Stopped timer was not saved');await tick();
        assert(!prompt(),'Switch prompt appeared while the setting is off');

        localStorage.setItem('planer:timer-switch-prompt:switch-user','true');window.dispatchEvent(new Event('planer:timer-preferences'));await tick();
        chip(study,'강의').click();await wait(()=>floatName()==='강의');
        stop();await wait(()=>prompt(),'Switch prompt did not appear after stopping');
        const groups=[...prompt().querySelectorAll('.timer-switch-group')].map(group=>[group.querySelector('h3').textContent,[...group.querySelectorAll('button')].map(button=>button.textContent)]);
        assert(JSON.stringify(groups)===JSON.stringify([['기록',['강의']],['통제',['휴식','이동','유튜브']]]),'Unexpected switch badges: '+JSON.stringify(groups));
        assert(prompt().querySelector('.timer-switch-finished').textContent.includes('강의'),'Prompt does not name the finished activity');

        // 통제 활동을 고르면 통제 타이머로 전환된다.
        [...prompt().querySelectorAll('button')].find(button=>button.textContent==='유튜브').click();
        await wait(()=>floatName()==='유튜브','Picking a control badge did not start the control timer');
        assert(!prompt(),'Prompt stayed open after switching');
        assert(control.querySelector('.timer-running')&&!study.querySelector('.timer-running'),'Switch started the wrong timer');

        // 다시 기록 활동으로 전환.
        stop();await wait(()=>prompt());
        assert(timerSwitchSaves.at(-1).activityId==='youtube'&&timerSwitchSaves.at(-1).control,'Control timer was not saved to control');
        [...prompt().querySelectorAll('button')].find(button=>button.textContent==='강의').click();
        await wait(()=>floatName()==='강의'&&study.querySelector('.timer-running'),'Picking a study badge did not start the study timer');

        // 종료하면 아무것도 시작하지 않는다.
        stop();await wait(()=>prompt());
        [...prompt().querySelectorAll('button')].find(button=>button.textContent==='종료').click();await tick();
        assert(!prompt()&&!document.querySelector('.float-timer')&&!document.querySelector('.timer-running'),'Ending still left a timer running');

        // 다른 탭(숨은 기록 화면)에서 정지하면 기록 화면으로 옮겨 창을 보여 준다.
        chip(study,'강의').click();await wait(()=>floatName()==='강의');
        hideTimerView('planner');await wait(()=>study.hidden,'Study panel did not hide');
        stop();await wait(()=>prompt(),'Switch prompt did not appear after stopping from another tab');
        assert(!study.hidden&&prompt().getBoundingClientRect().height>0,'Stopping from another tab left the prompt hidden');
        [...prompt().querySelectorAll('button')].find(button=>button.textContent==='종료').click();await tick();
        // 휴식은 휴식 타이머 설정 창으로 이어진다.
        chip(study,'강의').click();await wait(()=>floatName()==='강의');
        stop();await wait(()=>prompt());
        [...prompt().querySelectorAll('button')].find(button=>button.textContent==='휴식').click();
        await wait(()=>document.querySelector('dialog.planer-rest-setup[open]'),'Picking rest did not open the rest timer');
        assert(!document.querySelector('.timer-running'),'Rest started an elapsed timer');
        return {offByDefault:true,badgesGrouped:true,switchToControl:true,switchToStudy:true,endStops:true,restOpensRestTimer:true,revealsHiddenTab:true,saves:timerSwitchSaves.length};
      })()`);
      console.log(JSON.stringify(result));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
