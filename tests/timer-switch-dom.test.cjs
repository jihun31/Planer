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
        const wait=async(predicate,message='UI timed out')=>{const start=performance.now();while(!predicate()){if(performance.now()-start>8000)throw Error(message);await new Promise(resolve=>setTimeout(resolve,20));}};
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
        const {plannerDate,timerSegments}=await import('../../src/features/planner/scheduleTime.mjs');
        const [year,month,day]=plannerDate().split('-').map(Number);
        const realNow=Date.now;
        let restNow=new Date(year,month-1,day+1,4,58,10).getTime();
        Date.now=()=>restNow;
        const savesBeforeRest=timerSwitchSaves.length;
        button(setup(),'휴식 시작').click();
        await wait(()=>popups.length&&popupCommand,'Unlimited rest did not open');
        const active=popups.at(-1);
        const {restTimer}=await import('../../src/components/planner/restTimer.jsx');
        const saved=restTimer.read('switch-user');
        assert(active.endTs===null&&active.actName==='휴식'&&saved.minutes===null&&saved.session?.endTs===null,'Unlimited rest was not restored from storage');
        assert(saved.session.action===''&&!saved.session.returnActivityId,'Blank fields did not stay blank');
        assert(!review()&&reminders.length===0,'Unlimited rest expired or scheduled a reminder');
        restNow+=70000;
        popupCommand({type:'end',key:active.startTs+':null'});
        await wait(()=>review(),'Unlimited rest could not be ended');
        assert(!review().querySelector('.planer-rest-action'),'An empty return action was displayed');
        assert(timerSwitchSaves.length===savesBeforeRest,'A rest waiting for review was already saved');

        button(review(),'휴식 연장').click();await wait(()=>button(review(),'5분'));
        button(review(),'5분').click();await wait(()=>!button(review(),'연장 시작').disabled);
        button(review(),'연장 시작').click();
        await wait(()=>popups.length>1&&reminders.length,'Timed extension did not schedule a deadline');
        const timed=popups.at(-1);
        assert(Number.isFinite(timed.endTs)&&timed.endTs===reminders.at(-1).endTs,'Timed rest lost its deadline');
        restNow+=125000;
        popupCommand({type:'end',key:timed.startTs+':'+timed.endTs});
        await wait(()=>review());
        button(review(),'업무 복귀').click();
        await wait(()=>!review());
        assert(!document.querySelector('.timer-running'),'Work resumed with an unselected activity');
        assert(timerSwitchRestReturns.length===1&&timerSwitchRestReturns[0]===undefined,'Return to work did not invoke its callback');
        const recorded=timerSwitchSaves.at(-1),expected=timerSegments(active.startTs,restNow);
        assert(timerSwitchSaves.length===savesBeforeRest+1&&recorded.control&&recorded.customName==='휴식'&&recorded.group==='controlled',
          'The completed rest was not saved as one control timer');
        assert(expected.length===2&&JSON.stringify(recorded.segments)===JSON.stringify(expected),
          'The rest was not split across planner days at the actual finish time');
        assert(control.querySelector('.cal-day.cal-sel .cal-dot')&&control.querySelector('.ds-summary-group-activities')?.textContent.includes('휴식'),
          'The completed rest did not appear in the calendar and daily summary');

        restNow=new Date(year,month-1,day,12,0,10).getTime();
        chip(control,'휴식').click();await wait(()=>setup());
        button(setup(),'산책').click();
        await wait(()=>button(setup(),'산책').getAttribute('aria-pressed')==='true');
        button(setup(),'강의').click();
        await wait(()=>button(setup(),'강의').getAttribute('aria-pressed')==='true');
        const popupCount=popups.length;
        button(setup(),'휴식 시작').click();
        await wait(()=>popups.length>popupCount);
        const scheduled=restTimer.read('switch-user').session;
        assert(scheduled.returnActivityId==='lecture','Rest has no return activity to skip');
        restNow+=1000;
        popupCommand({type:'end',key:scheduled.startTs+':'+scheduled.endTs});
        await wait(()=>review());
        const end=button(review(),'종료');
        const position=element=>element.getBoundingClientRect().left;
        assert(end===end.parentElement.firstElementChild&&position(end)===position(end.parentElement),
          'End button is not on the left edge of the review actions');
        const attempts=[];
        let rejectFirstSave;
        window.timerSwitchBeforeSave=data=>{
          attempts.push(data);
          if(attempts.length===1)return new Promise((_resolve,reject)=>{rejectFirstSave=reject;});
        };
        end.click();end.click();
        await wait(()=>rejectFirstSave&&review()?.querySelector('[role="status"]'),'Rest was not sent for saving');
        rejectFirstSave(Error('Temporary save failure'));
        await wait(()=>review()?.querySelector('[role="alert"]')&&!button(review(),'종료').disabled,
          'Save failure did not keep the review open for retry');
        assert(attempts.length===1&&timerSwitchSaves.length===savesBeforeRest+1
          &&restTimer.read('switch-user').session?.endTs===restNow,'Duplicate clicks saved a rest or failure lost the original interval');
        restNow+=120000;
        button(review(),'종료').click();await wait(()=>!review());
        const short=timerSwitchSaves.at(-1);
        assert(attempts.length===2&&JSON.stringify(attempts[0])===JSON.stringify(attempts[1]),'Retry changed the rest record');
        assert(timerSwitchSaves.length===savesBeforeRest+2&&short.customName==='산책'&&short.segments.length===1
          &&short.segments[0].endMin-short.segments[0].startMin===1,'Short rest was not saved as a one-minute walk');
        assert(restTimer.read('switch-user').session===null,'End did not clear the rest session');
        assert(timerSwitchRestReturns.length===1,'End invoked the return to work callback');

        // 타이머 최소화: 기본으로 켜져 있고(ON), 끄면 원래 크기·버튼 문구로 돌아간다.
        restNow=new Date(year,month-1,day,13,0,0).getTime();
        chip(study,'강의').click();await wait(()=>floatName()==='강의');
        const floatBox=()=>document.querySelector('.float-timer');
        assert(floatBox().classList.contains('float-timer-compact'),'Compact timer is not enabled by default');
        assert(floatBox().querySelector('.ft-stop').textContent==='■ 정지','Compact float timer did not shorten stop button');
        assert(!floatBox().querySelector('.ft-start'),'Compact float timer showed start label');
        localStorage.setItem('planer:timer-compact:switch-user','false');window.dispatchEvent(new Event('planer:timer-preferences'));
        await wait(()=>!floatBox().classList.contains('float-timer-compact'),'Turning compact off did not expand float timer');
        assert(floatBox().querySelector('.ft-stop').textContent==='■ 정지 & 기록','Expanded float timer did not restore stop button');
        localStorage.setItem('planer:timer-compact:switch-user','true');window.dispatchEvent(new Event('planer:timer-preferences'));
        await wait(()=>floatBox().classList.contains('float-timer-compact'),'Turning compact back on did not shrink float timer');
        restNow+=51*60000;
        // 휴식 연결은 기본으로 꺼져 있다: 저장한 값이 없으면 50분 일하고 정지해도 휴식 버튼이 없다.
        const restButton=()=>prompt()?.querySelector('.study-gap-actions .timer-switch-rest');
        const badges=()=>[...prompt().querySelectorAll('.timer-switch-group button')].map(item=>item.textContent);
        assert(localStorage.getItem('planer:flow-rest:switch-user')===null,'Flow rest key was set before the default check');
        stop();await wait(()=>prompt(),'Switch prompt did not appear');
        assert(!restButton()&&badges().includes('휴식'),'Rest button appeared while flow rest is off by default');
        button(prompt(),'종료').click();await wait(()=>!prompt());
        localStorage.setItem('planer:flow-rest:switch-user','true');window.dispatchEvent(new Event('planer:timer-preferences'));await tick();

        // 두 설정이 모두 켜져 있으면 창 하나에 활동 배지와 휴식 버튼이 함께 나온다. 종료는 왼쪽, 휴식 시작은 오른쪽이고 휴식이 포커스를 받는다.
        // 종료·ESC는 창만 닫고, 배지를 고르면 휴식 없이 그 활동으로 바뀐다.
        const closeCases=[['종료',ask=>button(ask,'종료').click()],['ESC',ask=>ask.dispatchEvent(new Event('cancel',{cancelable:true}))]];
        for(const [label,close] of closeCases){
          chip(study,'강의').click();await wait(()=>floatName()==='강의');restNow+=50*60000;
          const skipPopups=popups.length,skipSaves=timerSwitchSaves.length;
          stop();await wait(()=>restButton(),'Combined dialog has no rest button ('+label+')');
          const actions=[...prompt().querySelectorAll('.study-gap-actions button')].map(item=>item.textContent);
          assert(JSON.stringify(actions)===JSON.stringify(['종료','휴식 시작 (10분)']),'Unexpected action row: '+JSON.stringify(actions));
          assert(restButton().classList.contains('study-gap-primary')&&document.activeElement===restButton(),'Rest button is not the focused primary button');
          assert(JSON.stringify(badges())===JSON.stringify(['강의','휴식','이동','유튜브']),'Badges missing next to the rest button: '+JSON.stringify(badges()));
          await tick();
          assert(popups.length===skipPopups&&restTimer.read('switch-user').session===null,'Rest started before pressing the button ('+label+')');
          assert(timerSwitchSaves.length===skipSaves+1,'Work was not saved before the dialog ('+label+')');
          close(prompt());await wait(()=>!prompt(),'Dialog did not close ('+label+')');await tick();
          assert(popups.length===skipPopups&&restTimer.read('switch-user').session===null&&!setup()&&!document.querySelector('.timer-running'),
            'Closing the dialog started something ('+label+')');
        }
        chip(study,'강의').click();await wait(()=>floatName()==='강의');restNow+=50*60000;
        stop();await wait(()=>restButton());
        button(prompt(),'유튜브').click();
        await wait(()=>floatName()==='유튜브','Picking a badge next to the rest button did not switch');
        assert(!prompt()&&restTimer.read('switch-user').session===null,'Picking a badge started the rest');
        // 통제 타이머를 정지하면 휴식 버튼 없이 활동 배지만 나온다.
        restNow+=50*60000;
        stop();await wait(()=>prompt());
        assert(!restButton()&&badges().length===4,'Control timer stop offered the flow rest');
        button(prompt(),'종료').click();await wait(()=>!prompt());

        // 다음 활동 창 설정을 끄고 휴식 연결만 켜면 휴식 버튼만 나온다.
        localStorage.setItem('planer:timer-switch-prompt:switch-user','false');window.dispatchEvent(new Event('planer:timer-preferences'));await tick();
        chip(study,'강의').click();await wait(()=>floatName()==='강의');restNow+=50*60000;
        const flowPopups=popups.length,flowSaves=timerSwitchSaves.length;
        stop();await wait(()=>restButton(),'Rest-only dialog did not appear');
        assert(!prompt().querySelector('.timer-switch-group'),'Badges shown while the switch setting is off');
        restButton().click();
        await wait(()=>popups.length>flowPopups,'Pressing rest did not start the rest timer');
        assert(!prompt(),'Dialog stayed open after starting the rest');
        const flow=restTimer.read('switch-user');
        assert(timerSwitchSaves.length===flowSaves+1&&timerSwitchSaves.at(-1).activityId==='lecture','Work was not saved before the rest');
        assert(flow.session.endTs-flow.session.startTs===10*60000&&flow.session.name==='휴식'&&flow.session.returnActivityId==='lecture',
          'Flow rest length or return activity is wrong: '+JSON.stringify(flow.session));
        assert(!prompt()&&!setup()&&!document.querySelector('.timer-running'),'Flow rest opened a dialog or left a timer running');
        restNow+=3*60000;
        popupCommand({type:'end',key:flow.session.startTs+':'+flow.session.endTs});
        await wait(()=>review());
        button(review(),'업무 복귀').click();await wait(()=>!review());
        assert(timerSwitchRestReturns.at(-1)==='lecture','Return to work did not resume the stopped activity');

        // 두 설정을 모두 끄면 정지 후 아무 창도 뜨지 않는다.
        chip(study,'강의').click();await wait(()=>floatName()==='강의');
        localStorage.setItem('planer:flow-rest:switch-user','false');window.dispatchEvent(new Event('planer:timer-preferences'));await tick();
        restNow+=30*60000;
        const offPopups=popups.length,offSaves=timerSwitchSaves.length;
        stop();await wait(()=>timerSwitchSaves.length>offSaves);await tick();
        assert(!prompt()&&popups.length===offPopups&&restTimer.read('switch-user').session===null,'A dialog or rest appeared with both settings off');
        Date.now=realNow;
        return {flowRest:true,timerCompact:true,offByDefault:true,badgesGrouped:true,switchToControl:true,switchToStudy:true,endStops:true,restOpensRestTimer:true,revealsHiddenTab:true,unlimitedRest:true,timedExtension:true,restEnd:true,calendarRest:true,restSaveRetry:true,saves:timerSwitchSaves.length};
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
      // 타이머 팝업 최소화 ON/OFF 전환 검증: compact일 때 시간이 상단 줄로 이동하고 버튼이 '■ 정지'가 된다.
      popup.webContents.send('timer:data',{actName:'글쓰기',color:'#8b5cf6',startTs:Date.now()-60000,startLabel:'13:00',compact:true});
      const compactState=await popup.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(()=>resolve({
        compact:document.body.dataset.compact,
        inHeader:document.querySelector('#header #time')!==null,
        stopText:document.querySelector('#stop-btn').textContent,
        startDisplay:getComputedStyle(document.querySelector('#start-label')).display,
      }),80))`);
      if(compactState.compact!=='true'||!compactState.inHeader||compactState.stopText!=='■ 정지'||compactState.startDisplay!=='none')
        throw Error('Compact popup layout mismatch: '+JSON.stringify(compactState));
      popup.webContents.send('timer:data',{actName:'글쓰기',color:'#8b5cf6',startTs:Date.now()-60000,startLabel:'13:00',compact:false});
      const normalState=await popup.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(()=>resolve({
        compact:document.body.dataset.compact,
        inHeader:document.querySelector('#header #time')!==null,
        stopText:document.querySelector('#stop-btn').textContent,
        startText:document.querySelector('#start-label').textContent,
      }),80))`);
      if(normalState.compact!=='false'||normalState.inHeader||normalState.stopText!=='■ 정지 & 기록'||normalState.startText!=='13:00 시작')
        throw Error('Normal popup layout mismatch: '+JSON.stringify(normalState));
      console.log(JSON.stringify({...result,unlimitedPopup:true,popupCompact:true}));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
