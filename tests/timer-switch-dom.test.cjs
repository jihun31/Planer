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
  const {app,BrowserWindow,ipcMain}=require('electron');app.setPath('userData',process.env.PLANER_PREVIEW_PROFILE);app.disableHardwareAcceleration();
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
        const setup=()=>document.querySelector('dialog.planer-rest-setup[open]');
        const review=()=>document.querySelector('dialog.planer-rest-review[open]');
        const button=(dialog,text)=>[...dialog.querySelectorAll('button')].find(item=>item.textContent===text);
        const setInput=(input,value)=>{
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
          input.dispatchEvent(new Event('input',{bubbles:true}));
        };
        const popups=[],reminders=[];
        let popupCommand;
        window.electronAPI={
          onTimerStopped:()=>()=>{},
          openRestPopup:async data=>{popups.push(data);return {ok:true};},
          onRestPopupCommand:callback=>{popupCommand=callback;return ()=>{popupCommand=null;};},
          scheduleRestReminder:data=>reminders.push(data),
        };

        button(setup(),'활동 관리').click();
        await wait(()=>setup().querySelector('#planer-rest-activity'));
        setInput(setup().querySelector('#planer-rest-activity'),'산책');
        await wait(()=>!button(setup(),'+ 활동 추가').disabled);
        button(setup(),'+ 활동 추가').click();
        await wait(()=>button(setup(),'산책'));
        const walk=button(setup(),'산책');
        walk.click();await wait(()=>walk.getAttribute('aria-pressed')==='true');
        walk.click();await wait(()=>walk.getAttribute('aria-pressed')==='false');
        assert(button(setup(),'강의').getAttribute('aria-pressed')==='false','Return activity should start unselected');
        assert(!button(setup(),'휴식 시작').disabled,'Optional fields blocked a timed rest');

        const custom=button(setup(),'직접 입력');
        const unlimited=button(setup(),'제한 없음');
        assert(custom.nextElementSibling===unlimited,'Unlimited duration is out of order');
        custom.click();await wait(()=>button(setup(),'휴식 시작').disabled);
        unlimited.click();await wait(()=>!button(setup(),'휴식 시작').disabled);
        assert(unlimited.getAttribute('aria-pressed')==='true'&&!setup().querySelector('[type="number"]'),'Unlimited duration still shows custom entry');
        button(setup(),'휴식 시작').click();
        await wait(()=>popups.length&&popupCommand,'Unlimited rest did not open');
        const active=popups.at(-1);
        const {restTimer}=await import('../../src/components/planner/restTimer.jsx');
        const saved=restTimer.read('switch-user');
        assert(active.endTs===null&&active.actName==='휴식'&&saved.minutes===null&&saved.session?.endTs===null,'Unlimited rest was not restored from storage');
        assert(saved.session.action===''&&!saved.session.returnActivityId,'Blank fields did not stay blank');
        assert(!review()&&reminders.length===0,'Unlimited rest expired or scheduled a reminder');
        popupCommand({type:'end',key:active.startTs+':null'});
        await wait(()=>review(),'Unlimited rest could not be ended');
        assert(!review().querySelector('.planer-rest-action'),'An empty return action was displayed');

        button(review(),'휴식 연장').click();await wait(()=>button(review(),'5분'));
        button(review(),'5분').click();await wait(()=>!button(review(),'연장 시작').disabled);
        button(review(),'연장 시작').click();
        await wait(()=>popups.length>1&&reminders.length,'Timed extension did not schedule a deadline');
        const timed=popups.at(-1);
        assert(Number.isFinite(timed.endTs)&&timed.endTs===reminders.at(-1).endTs,'Timed rest lost its deadline');
        popupCommand({type:'end',key:timed.startTs+':'+timed.endTs});
        await wait(()=>review());
        button(review(),'업무 복귀').click();
        await wait(()=>!review());
        assert(!document.querySelector('.timer-running'),'Work resumed with an unselected activity');
        return {offByDefault:true,badgesGrouped:true,switchToControl:true,switchToStudy:true,endStops:true,restOpensRestTimer:true,revealsHiddenTab:true,unlimitedRest:true,timedExtension:true,saves:timerSwitchSaves.length};
      })()`);
      const popup=new BrowserWindow({show:false,webPreferences:{
        sandbox:true,offscreen:true,backgroundThrottling:false,preload:path.join(__dirname,'../electron/preload.cjs'),
      }});
      const commands=[];
      ipcMain.on('rest:popup-command',(_event,command)=>commands.push(command));
      await popup.loadFile(path.join(__dirname,'../electron/timer-popup.html'));
      const startTs=Date.now()-4000;
      const key=startTs+':null';
      popup.webContents.send('timer:data',{mode:'rest',startTs,endTs:null,key,actName:'휴식',color:'#6366f1'});
      await popup.webContents.executeJavaScript(`(async()=>{
        const text=()=>document.querySelector('#time').textContent;
        const deadline=Date.now()+4000;
        while(Number(text().split(':').at(-1))<5){
          if(Date.now()>deadline)throw Error('Unlimited popup did not count elapsed time');
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        document.querySelector('#stop-btn').click();
      })()`);
      await new Promise(resolve=>setTimeout(resolve,100));
      if(commands.length!==1||commands[0].type!=='end'||commands[0].key!==key)throw Error('Unlimited popup sent an unexpected command');
      console.log(JSON.stringify({...result,unlimitedPopup:true}));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
