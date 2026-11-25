const fs=require('node:fs'),path=require('node:path');
if(!process.versions.electron){
  (async()=>{
    const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
    const root=path.resolve(__dirname,'..'),temporary=path.join(root,'.tmp');fs.mkdirSync(temporary,{recursive:true});
    const profile=fs.mkdtempSync(path.join(temporary,'planner-integration-'));
    const mock=path.join(root,'tests/fixtures/planner-preview-data.jsx');
    const server=await createServer({configFile:false,root,cacheDir:path.join(profile,'vite-cache'),plugins:[{
      name:'preview-private-data',enforce:'pre',resolveId(source){
        if(['/features/planner/usePlanner','/features/planner/useControl','/features/plans/useDayPlans'].some(suffix=>source.endsWith(suffix)))return mock;
      },
    },react()],optimizeDeps:{entries:['tests/fixtures/planner-integration.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.tmp/**','**/local-data/**']}},clearScreen:false});
    try{
      await server.listen();const env={...process.env,PLANER_PREVIEW_PROFILE:profile,PLANER_PREVIEW_URL:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/planner-integration.html`};delete env.ELECTRON_RUN_AS_NODE;
      const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'}),timeout=setTimeout(()=>child.kill(),60000);
      process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code??1));child.once('error',reject);});clearTimeout(timeout);
    }finally{await server.close();if(path.dirname(profile)===temporary&&path.basename(profile).startsWith('planner-integration-'))fs.rmSync(profile,{recursive:true,force:true});}
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
        const tick=()=>new Promise(resolve=>setTimeout(resolve,50));
        const study=document.querySelector('#study'),control=document.querySelector('#control');
        const schedule=root=>root.querySelector('.daily-schedule'),busy=root=>schedule(root)?.getAttribute('aria-busy')==='true';
        const cell=(root,minute)=>root.querySelector('[data-schedule-minute="'+minute+'"]');
        await wait(()=>schedule(study)&&schedule(control)&&!busy(study)&&!busy(control));
        await wait(()=>cell(study,80).style.backgroundColor&&getComputedStyle(cell(study,80)).backgroundColor===cell(study,80).style.backgroundColor);
        const block=start=>study.querySelector('[data-plan-start="'+start+'"]');
        assert(block(630)&&block(660)&&!block(60),'Different recorded activity left a plan outline or removed unrelated plans');
        assert(study.querySelectorAll('.ds-plan-name').length===1,'A plan wrapped over two rows must show its label once');
        assert(getComputedStyle(cell(study,630)).backgroundColor==='rgb(255, 255, 255)','Plan cell has a colored background');
        assert(!cell(study,60).classList.contains('ds-td-plan'),'Removed plan still hides the empty grid');
        for(let minute=630;minute<659;minute++)assert(getComputedStyle(cell(study,minute)).borderRightWidth==='0px','Internal grid line remains in the plan block');
        const planBlock=block(630),outline=getComputedStyle(planBlock);
        assert(outline.backgroundImage.split('linear-gradient').length-1===4&&outline.backgroundImage.includes('rgb(226, 226, 252)')
          &&outline.backgroundSize.split(',').every(size=>size.includes('3px'))&&outline.boxShadow==='none','Plan outline is not a solid pale 3px frame of four edges');
        for(const side of ['Top','Right','Bottom','Left'])assert(outline['border'+side+'Width']==='0px','Plan frame still changes the box size');
        assert(getComputedStyle(planBlock.querySelector('.ds-plan-name')).color==='rgb(99, 102, 241)','Plan label does not use its activity color');
        assert(Number(outline.zIndex)>2,'Plan outline can be covered by adjacent cells');
        assert(!cell(study,60).classList.contains('ds-td-filled')&&!cell(study,60).querySelector('.ds-del'),'A plan became an actual record');
        assert(cell(study,80).classList.contains('ds-td-filled')&&!cell(study,80).classList.contains('ds-td-plan'),'Actual record does not take priority');
        const hint=planBlock.querySelector('.ds-plan-name'),hintRect=hint.getBoundingClientRect(),first=cell(study,630).getBoundingClientRect(),last=cell(study,659).getBoundingClientRect();
        assert(Math.abs((hintRect.left+hintRect.right)/2-(first.left+last.right)/2)<2,'Plan label is not centered in the empty interval');
        const checkBounds=()=>{for(const [start,end] of [[630,660],[660,690]]){
          const box=block(start).getBoundingClientRect(),left=cell(study,start).getBoundingClientRect(),right=cell(study,end-1).getBoundingClientRect();
          assert(Math.abs(box.left-left.left)<1&&Math.abs(box.right-right.right)<1,'18:30–19:30 outline extends beyond its grid columns');
          assert(Math.abs(box.top-left.top)<1&&Math.abs(box.bottom-left.bottom)<1,'Plan outline extends beyond its hour row');
        }};checkBounds();
        assert(!study.querySelector('.ds-header-right').textContent.includes('계획 공부'),'Plan entered the recorded-time total');
        assert(!control.querySelector('.ds-plan-name'),'Study plans leaked into the control timetable');
        assert(plannerPreviewWrites.length===0,'Opening a day materialized actual/future records');
        for(const root of [study,control]){
          const node=schedule(root),scroll=node.querySelector('.ds-scroll'),cal=root.querySelector('.planner-cal');
          const tableTop=node.getBoundingClientRect().top,calHeight=cal.getBoundingClientRect().height;
          scroll.scrollTop=130;const scrollTop=scroll.scrollTop;
          cell(root,60).click();await tick();
          for(const direction of [1,1,1,-1,-1,-1]){
            const nav=root.querySelectorAll('.cal-nav');nav[direction>0?1:0].click();
            await wait(()=>busy(root),'Month transition did not enter loading');
            assert(schedule(root)===node,'Month navigation unmounted the selected timetable');
            assert(scroll.scrollTop===scrollTop,'Month navigation reset timetable scroll');
            assert(Math.abs(node.getBoundingClientRect().top-tableTop)<1,'Loading status moved the timetable');
            assert(Math.abs(cal.getBoundingClientRect().height-calHeight)<1,'Month navigation changed calendar height');
            assert(root.querySelector('.ds-sel-pending'),'Month navigation discarded a pending selection');
            assert(cell(root,80).classList.contains('ds-td-filled'),'Known actual records disappeared while loading');
            assert(root.querySelector('.ds-form-fields').disabled,'Writing was enabled during a stale month transition');
            await wait(()=>!busy(root));
            assert(schedule(root)===node&&scroll.scrollTop===scrollTop,'Loaded month replaced the timetable');
          }
          root.querySelector('.ds-clear-btn').click();await tick();
        }
        cell(study,630).click();await tick();cell(study,644).click();await tick();
        [...study.querySelectorAll('.act-chip-start')].find(button=>button.textContent==='계획 공부').click();
        await wait(()=>plannerPreviewWrites.length===1&&cell(study,630).classList.contains('ds-td-filled'));
        assert(plannerPreviewWrites[0].startMin===630&&plannerPreviewWrites[0].endMin===645,'Plan overlay blocked normal record selection');
        cell(study,645).click();await tick();cell(study,659).click();await tick();
        [...study.querySelectorAll('.act-chip-start')].find(button=>button.textContent==='계획 공부').click();
        await wait(()=>plannerPreviewWrites.length===2&&cell(study,645).classList.contains('ds-td-filled'));
        assert(block(630)&&block(660),'Matching activity removed the planned outline');
        assert(study.querySelectorAll('.ds-plan-name').length===0,'Actual recording did not clear the plan labels');
        // One label spans the whole joined run (18:30-19:00 → grid columns 32-62) and is centered by text-align.
        const labels=()=>[...study.querySelectorAll('.ds-table > .ds-cell-name')].filter(label=>label.textContent==='계획 공부'&&label.style.gridColumn==='32 / 62');
        assert(labels().length===1&&!study.querySelector('[data-schedule-minute] .ds-cell-name')&&getComputedStyle(labels()[0]).textAlign==='center',
          'Adjacent records repeat the activity label instead of centering one label');
        assert(getComputedStyle(cell(study,644)).borderRightWidth==='0px','Adjacent records retain an internal divider');
        assert(study.querySelector('.ds-header-right').textContent.includes('계획 공부 30m')&&study.querySelector('.ds-header-right').textContent.includes('실제 공부 20m'),'Merged records changed the actual duration totals');
        const hover=node=>node.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
        const leave=node=>node.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}));
        for(const [root,minute,expected] of [[study,623,'18:23'],[study,652,'계획 공부|18:30–19:00 (30분)'],
          [control,80,'통제 활동|09:20–09:40 (20분)'],[control,205,'11:25']]){
          hover(cell(root,minute));await tick();
          const shown=[...root.querySelectorAll('.ds-time-tip > *')].map(part=>part.textContent).join('|');
          assert(shown===expected,'Hover tip at minute '+minute+' shows "'+shown+'" instead of "'+expected+'"');
          leave(cell(root,minute));await tick();
          assert(!root.querySelector('.ds-time-tip'),'Hover tip remains after leaving the cell');
        }
        cell(study,660).click();await tick();cell(study,674).click();await tick();
        [...study.querySelectorAll('.act-chip-start')].find(button=>button.textContent==='실제 공부').click();
        await wait(()=>plannerPreviewWrites.length===3&&cell(study,660).classList.contains('ds-td-filled'));
        assert(!block(630)&&!block(660),'Different activity left part of the plan outline');
        cell(study,660).querySelector('.ds-del').click();
        await wait(()=>!!block(630)&&!!block(660));
        assert(labels().length===1,'Deleting a conflicting record broke the merged activity display');
        checkBounds();

        const preview = document.querySelector('#reminder-width');
        const reminder = () => preview.querySelector('.task-reminder');
        const displayed = () => [...preview.querySelectorAll('input[type=checkbox]')];
        const more = () => preview.querySelector('button.task-reminder-more');
        const todayCheck = name => [...document.querySelectorAll('#reminder-preview .today-task-list input')]
          .find(input => input.getAttribute('aria-label') === name);
        const displayedCheck = name => displayed().find(input => input.getAttribute('aria-label') === name);
        assert(setReminderClock(22, 4, 59) === 60000, '새벽 5시로 날짜 전환을 예약해야 합니다.');
        await wait(() => displayed().length === 1 && displayedCheck('어제 할 일 완료'));
        setReminderClock(22, 5, 0, true);
        await wait(() => displayed().length === 6);
        assert(displayed()[0].getAttribute('aria-label') === '영어 듣기 완료', '오전 할 일을 등록 순서로 표시해야 합니다.');
        assert(displayedCheck('시간대 없는 예전 할 일 완료') && displayedCheck('이미 완료한 할 일 완료')?.checked,
          '시간대 없는 할 일과 이미 완료한 할 일도 새벽 5시부터 표시해야 합니다.');
        assert(setReminderClock(22, 9, 59) === (19 * 60 + 1) * 60000, '하루 중에는 다음 새벽 5시만 예약해야 합니다.');
        const reminderStyle = getComputedStyle(reminder());
        assert(reminderStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && reminderStyle.borderBottomWidth === '1px',
          '알림은 배경 강조 없이 얇은 구분선을 표시해야 합니다.');
        assert(setReminderClock(23, 4, 59) === 60000,
          '새벽 5시 전까지 전날의 할 일을 유지해야 합니다.');
        await tick();
        assert(displayed().length === 6 && displayedCheck('이미 완료한 할 일 완료')?.checked,
          '자정 이후에도 새벽 5시 전까지 완료 상태와 항목을 유지해야 합니다.');
        setReminderClock(23, 5, 0, true);
        await wait(() => displayed().length === 1 && displayedCheck('다음 날 할 일 완료'));
        setReminderClock(22, 5, 0);
        preview.style.width = '280px';
        await wait(() => more() && displayed().length > 0 && displayed().length < 6);
        assert(more().textContent === '+' + (6 - displayed().length) + '개 더 보기', '숨겨진 할 일 수를 표시해야 합니다.');
        const visibleCheck = displayed()[0];
        const inlineRow = visibleCheck.closest('.task-reminder-line');
        const rowBounds = inlineRow.getBoundingClientRect();
        assert(more().getBoundingClientRect().right <= rowBounds.right + 1 &&
          displayed().every(check => check.closest('.task-reminder-line') === inlineRow),
          '접힌 상태에서 할 일과 더 보기 버튼이 한 줄에 들어가야 합니다.');
        const visibleName = visibleCheck.getAttribute('aria-label');
        window.failReminderWrite = true;
        visibleCheck.click();
        await wait(() => reminder().querySelector('[role=alert]') && !visibleCheck.disabled);
        assert(!todayCheck(visibleName).checked && !visibleCheck.checked, '저장 실패 후 다시 체크할 수 있어야 합니다.');
        window.failReminderWrite = false;
        visibleCheck.click();
        await wait(() => todayCheck(visibleName).checked && displayedCheck(visibleName)?.checked && !displayedCheck(visibleName).disabled);
        more().click();
        await wait(() => more()?.getAttribute('aria-expanded') === 'true' && displayed().length === 6);
        const extraCheck = displayedCheck('리포트 읽고 수정 부분 표시하기 완료');
        const extraName = extraCheck.getAttribute('aria-label');
        extraCheck.click();
        await wait(() => todayCheck(extraName).checked && displayedCheck(extraName)?.checked && !displayedCheck(extraName).disabled);
        displayedCheck(extraName).click();
        await wait(() => !todayCheck(extraName).checked && displayedCheck(extraName)?.checked === false);
        preview.style.width = '';
        await wait(() => !more() && displayed().length === 6);
        return {whitePlanHints:true,differentActivityRemovesOutline:true,adjacentActivitiesMerged:true,actualRecordsPrioritized:true,plansExcludedFromTotals:true,noFutureWrites:true,monthLayoutStable:true,scrollAndSelectionRetained:true,controlMonthStable:true,taskReminderVerified:true};
      })()`);
      for(const width of [1000,1600]){
        win.setContentSize(width,980);
        await win.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(resolve,100))`);
        const aligned=await win.webContents.executeJavaScript(`[[630,660],[660,690]].every(([start,end])=>{
          const root=document.querySelector('#study'),box=root.querySelector('[data-plan-start="'+start+'"]').getBoundingClientRect();
          const first=root.querySelector('[data-schedule-minute="'+start+'"]').getBoundingClientRect(),last=root.querySelector('[data-schedule-minute="'+(end-1)+'"]').getBoundingClientRect();
          return Math.abs(box.left-first.left)<1&&Math.abs(box.right-last.right)<1;
        })`);
        if(!aligned)throw Error('Plan outline overflows at viewport width '+width);
      }
      win.setContentSize(1360,980);
      const frameRect=await win.webContents.executeJavaScript(`(async()=>{
        const frame=document.querySelector('#study [data-plan-start="660"]');frame.scrollIntoView({block:'center',inline:'nearest'});
        await new Promise(resolve=>setTimeout(resolve,100));
        const box=frame.getBoundingClientRect(),x=Math.floor(box.left),y=Math.floor(box.top);
        return {x,y,width:Math.ceil(box.right)-x,height:Math.ceil(box.bottom)-y,left:box.left-x,right:box.right-x,top:box.top-y,bottom:box.bottom-y};
      })()`);
      const frameImage=await win.webContents.capturePage({x:frameRect.x,y:frameRect.y,width:frameRect.width,height:frameRect.height});
      if(process.env.PLANER_PREVIEW_SCREENSHOT)fs.writeFileSync(process.env.PLANER_PREVIEW_SCREENSHOT.replace(/\.png$/, '-frame.png'),frameImage.toPNG());
      const bitmap=frameImage.toBitmap(),size=frameImage.getSize(),scale=Math.sqrt(bitmap.length/4/(size.width*size.height));
      const pixelsWide=Math.round(size.width*scale),pixelsHigh=Math.round(size.height*scale);
      const pixel=(x,y)=>{const col=Math.min(pixelsWide-1,Math.max(0,Math.floor(x/frameRect.width*pixelsWide))),row=Math.min(pixelsHigh-1,Math.max(0,Math.floor(y/frameRect.height*pixelsHigh))),offset=(row*pixelsWide+col)*4;return [bitmap[offset+2],bitmap[offset+1],bitmap[offset]];};
      const {left,right,top,bottom}=frameRect,middleX=(left+right)/2,middleY=(top+bottom)/2;
      const edgePixels=[pixel(left+1.5,middleY),pixel(right-1.5,middleY),pixel(middleX,top+1.5),pixel(middleX,bottom-1.5)];
      // Fractional device-pixel positions can vary the rasterized color slightly.
      if(edgePixels.some(rgb=>rgb.some((channel,index)=>Math.abs(channel-[226,226,252][index])>3)))throw Error('Rendered frame edges differ: '+JSON.stringify({edgePixels,frameRect,size,scale}));
      const innerPixels=[pixel(left+4.5,middleY),pixel(right-4.5,middleY),pixel(middleX,top+4.5),pixel(middleX,bottom-4.5)];
      if(innerPixels.some(rgb=>rgb.some(channel=>Math.abs(channel-255)>1)))throw Error('Frame extends too far inward: '+JSON.stringify(innerPixels));
      result.equalRenderedEdges=true;
      // A real pointer must reach the cell under overlays, and the tip stays within the table at both edges.
      for(const minute of [600,659]){
        const point=await win.webContents.executeJavaScript(`(async()=>{
          const cell=document.querySelector('#study [data-schedule-minute="${minute}"]');cell.scrollIntoView({block:'center'});
          await new Promise(resolve=>setTimeout(resolve,100));
          const box=cell.getBoundingClientRect();return {x:Math.round(box.left+box.width/2),y:Math.round(box.top+box.height/2)};
        })()`);
        win.webContents.sendInputEvent({type:'mouseMove',...point});
        const placed=await win.webContents.executeJavaScript(`(async()=>{
          await new Promise(resolve=>setTimeout(resolve,250));
          const root=document.querySelector('#study'),tip=root.querySelector('.ds-time-tip');if(!tip)return 'missing';
          const box=tip.getBoundingClientRect(),table=root.querySelector('.ds-table').getBoundingClientRect(),
            cell=root.querySelector('[data-schedule-minute="${minute}"]').getBoundingClientRect();
          return box.left>=table.left&&box.right<=table.right+1&&box.bottom<=cell.top&&box.height<32?'ok':JSON.stringify({box,table,cell});
        })()`);
        if(placed!=='ok')throw Error('Hover tip misplaced at minute '+minute+': '+placed);
        if(process.env.PLANER_PREVIEW_SCREENSHOT)fs.writeFileSync(process.env.PLANER_PREVIEW_SCREENSHOT.replace(/\.png$/, '-tip-'+minute+'.png'),(await win.webContents.capturePage()).toPNG());
      }
      result.hoverTimeShown=true;
      if(process.env.PLANER_PREVIEW_SCREENSHOT){await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,250))');fs.writeFileSync(process.env.PLANER_PREVIEW_SCREENSHOT,(await win.webContents.capturePage()).toPNG());}
      console.log(JSON.stringify(result));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
