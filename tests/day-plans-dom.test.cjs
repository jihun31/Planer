const fs=require('node:fs'),path=require('node:path');
if(!process.versions.electron){
  (async()=>{
    const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
    const temporary=path.resolve(__dirname,'../.tmp');fs.mkdirSync(temporary,{recursive:true});
    const profile=fs.mkdtempSync(path.join(temporary,'day-plans-test-'));
    const server=await createServer({configFile:false,root:path.resolve(__dirname,'..'),cacheDir:path.join(profile,'vite-cache'),plugins:[react()],
      optimizeDeps:{entries:['tests/fixtures/day-plans.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.tmp/**','**/local-data/**']}},clearScreen:false});
    try{
      await server.listen();const env={...process.env,PLANER_PLAN_TEST_PROFILE:profile,PLANER_PLAN_TEST_URL:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/day-plans.html`};delete env.ELECTRON_RUN_AS_NODE;
      const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'});
      const timeout=setTimeout(()=>child.kill(),45000);
      process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code??1));child.once('error',reject);});clearTimeout(timeout);
    }finally{await server.close();if(path.dirname(profile)===temporary&&path.basename(profile).startsWith('day-plans-test-'))fs.rmSync(profile,{recursive:true,force:true});}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}else{
  const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.PLANER_PLAN_TEST_PROFILE);app.disableHardwareAcceleration();
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    try{
      await win.loadURL(process.env.PLANER_PLAN_TEST_URL);
      const result=await win.webContents.executeJavaScript(`(async()=>{
        const assert=(value,message)=>{if(!value)throw Error(message);};
        const wait=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>7000)throw Error('UI timed out');await new Promise(resolve=>setTimeout(resolve,20));}};
        const tick=()=>new Promise(resolve=>setTimeout(resolve,50));
        const click=label=>document.querySelector('[aria-label="'+label+'"]').click();
        const rows=()=>[...document.querySelectorAll('.day-plan-timetable .ds-del')];
        const submit=()=>document.querySelector('.day-plan-form button[type="submit"]').click();
        const cell=minute=>document.querySelector('[data-plan-minute="'+minute+'"]');
        const select=async(start,last)=>{cell(start).click();await tick();cell(last).click();await tick();};
        await wait(()=>document.querySelector('.day-plan-activities button'));
        const initialDate=planTestState.date;
        assert(!document.querySelector('.day-plan-date').textContent.includes('계획 날짜'),'Visible date label remains');
        click('계획표 다음 날짜');await wait(()=>planTestState.date!==initialDate);
        const tomorrow=new Date(initialDate+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
        assert(planTestState.date===tomorrow.toISOString().slice(0,10),'Next arrow did not advance one day');
        assert(document.querySelector('#shared-date').textContent.includes(planTestState.date),'Date arrow did not update the shared task date');
        assert(document.querySelector('.day-plan-date input').value===planTestState.date,'Date input did not follow arrow navigation');
        click('계획표 이전 날짜');await wait(()=>planTestState.date===initialDate);
        assert(!document.querySelector('.day-plan-form input:not([type=radio],[type=checkbox])'),'Activity name input remains');
        assert(!document.querySelector('input[type="time"]'),'Old time-entry form remains');
        assert(document.querySelectorAll('.day-plan-cell').length===19*60,'Grid does not use the time-management range');
        assert(document.querySelector('.ds-td-time').textContent==='08:00'&&[...document.querySelectorAll('.ds-td-time')].at(-1).textContent==='02:00','Range boundaries differ');
        assert(!document.querySelector('.day-plan-timetable').textContent.includes('다음'),'Next-day text remains in the timetable');
        const activityButtons=()=>[...document.querySelectorAll('.day-plan-activities button')];
        assert(activityButtons().map(button=>button.textContent).join(',')==='영어 공부,운동','Activity source/order/archive filtering differs');
        assert(activityButtons()[0].style.color==='rgb(34, 197, 94)','Activity color differs');
        const badgesRect=document.querySelector('.day-plan-activities').getBoundingClientRect(),controlsRect=document.querySelector('.day-plan-controls').getBoundingClientRect();
        assert(controlsRect.left>=badgesRect.right&&controlsRect.top<badgesRect.bottom&&controlsRect.bottom>badgesRect.top,'Controls are not beside activity badges');
        activityButtons()[0].click();await tick();
        await select(540,599);assert(document.querySelectorAll('.ds-td-confirmed').length===60,'Grid selected the wrong duration');
        document.querySelector('input[value="weekly"]').click();await tick();
        submit();await wait(()=>rows().length===1);assert(planTestState.versions.length===1,'Routine was not created');
        assert(planTestState.versions[0].activityId==='english'&&planTestState.versions[0].activityColor==='#22c55e','Routine lost its activity association');
        const firstDate=planTestState.date;document.querySelector('#next-week').click();await wait(()=>planTestState.date!==firstDate&&rows().length===1);
        assert(document.querySelector('#shared-date').textContent.includes(planTestState.date),'Shared selected date did not update');
        assert(document.querySelector('.ds-td-time').textContent==='09:00'&&[...document.querySelectorAll('.ds-td-time')].at(-1).textContent==='22:00','Date-specific range or existing-plan preservation failed');
        assert(!document.querySelector('.day-plan-selection strong'),'Date change retained the prior selection');
        cell(570).click();await tick();await select(660,719);submit();
        await wait(()=>planTestState.entries.some(entry=>entry.date===planTestState.date&&entry.startMinute===660));assert(cell(660).getAttribute('aria-label').includes('영어 공부'),'Day edit did not update time');
        document.querySelector('#previous-week').click();await wait(()=>planTestState.date===firstDate);assert(cell(540).getAttribute('aria-label').includes('영어 공부'),'Day edit changed another week');
        click('영어 공부 이번 날짜 제외');await wait(()=>rows().length===0);document.querySelector('.day-plan-skipped').open=true;
        [...document.querySelectorAll('button')].find(button=>button.textContent==='되돌리기').click();await wait(()=>rows().length===1);
        activityButtons()[1].click();await select(780,809);submit();await wait(()=>rows().length===2);
        click('운동 계획 삭제');await wait(()=>rows().length===1);
        await select(600,629);[...document.querySelectorAll('.day-plan-activities button')].find(button=>button.textContent==='영어 공부').click();await wait(()=>rows().length===2);
        assert(planTestState.entries.some(entry=>entry.startMinute===600&&entry.endMinute===630),'Activity click did not register selected cells');
        assert(planTestState.entries.some(entry=>entry.activityId==='english'&&entry.activityColor==='#22c55e'),'Activity quick save lost metadata');
        cell(600).parentElement.querySelector('.ds-del').click();await wait(()=>rows().length===1);
        activityButtons()[1].click();await select(1425,1454);
        assert(!document.querySelector('.day-plan-selection').textContent.includes('다음'),'Next-day text remains in the selection');
        submit();await wait(()=>rows().length===2);
        assert(planTestState.entries.some(entry=>entry.startMinute===1425&&entry.endMinute===1455),'Overnight grid range shifted dates');
        click('운동 계획 삭제');await wait(()=>rows().length===1);
        activityButtons()[1].click();await select(1560,1589);submit();await wait(()=>rows().length===2);
        assert(planTestState.entries.some(entry=>entry.date===firstDate&&entry.startMinute===1560&&entry.endMinute===1590),'Next-day start could not be saved in the selected planner day');
        click('운동 계획 삭제');await wait(()=>rows().length===1);
        document.querySelector('#rename-activity').click();await wait(()=>cell(570).getAttribute('aria-label').includes('영어 회화'));
        assert(cell(570).parentElement.style.background.includes('59, 130, 246'),'Live activity color did not reach the grid');
        document.querySelector('#archive-activity').click();await tick();assert(activityButtons().every(button=>button.textContent!=='영어 회화'),'Archived activity remains selectable');assert(cell(570).getAttribute('aria-label').includes('영어 회화'),'Archiving removed existing plans');
        document.querySelector('#narrow-range').click();await tick();assert(document.querySelector('.ds-td-time').textContent==='09:00'&&[...document.querySelectorAll('.ds-td-time')].at(-1).textContent==='22:00','Changed range hid an existing plan');
        cell(780).click();await tick();cell(780).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert(document.activeElement===cell(781),'Grid keyboard navigation failed');
        cell(781).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();assert(!document.querySelector('.day-plan-selection strong'),'Escape did not clear selection');
        return {minuteGrid:true,weekly:true,dayOverrideIsolated:true,skipAndRestore:true,singleDelete:true,sharedDate:true,activityQuickSave:true,overnight:true,keyboard:true,sharedActivities:true,sharedRange:true,nextDayStart:true};
      })()`);
      if(process.env.PLANER_PLAN_SCREENSHOT){
        await win.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(resolve,250))`);
        fs.writeFileSync(process.env.PLANER_PLAN_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
      }
      win.setContentSize(390,844);
      const overflow=await win.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(()=>resolve(document.documentElement.scrollWidth>innerWidth),150))`);
      if(overflow)throw Error('Plan block overflows mobile viewport');
      console.log(JSON.stringify({...result,mobileOverflow:false}));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
