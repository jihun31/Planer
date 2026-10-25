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
        assert(study.querySelectorAll('.ds-plan-name').length===2&&!block(60),'Different recorded activity left a plan outline or removed unrelated plans');
        assert(getComputedStyle(cell(study,630)).backgroundColor==='rgb(255, 255, 255)','Plan cell has a colored background');
        assert(!cell(study,60).classList.contains('ds-td-plan'),'Removed plan still hides the empty grid');
        for(let minute=630;minute<659;minute++)assert(getComputedStyle(cell(study,minute)).borderRightWidth==='0px','Internal grid line remains in the plan block');
        const planBlock=block(630),outline=getComputedStyle(planBlock);
        assert(outline.boxShadow.includes('rgb(226, 226, 252)')&&outline.boxShadow.includes('3px')&&outline.boxShadow.includes('inset'),'Plan outline is not a solid pale 3px inset frame');
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
        const labels=()=>Array.from({length:30},(_,i)=>cell(study,630+i).querySelector('.ds-cell-name')).filter(Boolean);
        assert(labels().length===1&&cell(study,645).querySelector('.ds-cell-name'),'Adjacent records repeat the activity label instead of centering one label');
        assert(getComputedStyle(cell(study,644)).borderRightWidth==='0px','Adjacent records retain an internal divider');
        assert(study.querySelector('.ds-header-right').textContent.includes('계획 공부 30m')&&study.querySelector('.ds-header-right').textContent.includes('실제 공부 20m'),'Merged records changed the actual duration totals');
        cell(study,660).click();await tick();cell(study,674).click();await tick();
        [...study.querySelectorAll('.act-chip-start')].find(button=>button.textContent==='실제 공부').click();
        await wait(()=>plannerPreviewWrites.length===3&&cell(study,660).classList.contains('ds-td-filled'));
        assert(!block(630)&&!block(660),'Different activity left part of the plan outline');
        cell(study,660).querySelector('.ds-del').click();
        await wait(()=>!!block(630)&&!!block(660));
        assert(labels().length===1,'Deleting a conflicting record broke the merged activity display');
        checkBounds();
        return {whitePlanHints:true,differentActivityRemovesOutline:true,adjacentActivitiesMerged:true,actualRecordsPrioritized:true,plansExcludedFromTotals:true,noFutureWrites:true,monthLayoutStable:true,scrollAndSelectionRetained:true,controlMonthStable:true};
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
      if(process.env.PLANER_PREVIEW_SCREENSHOT){await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,250))');fs.writeFileSync(process.env.PLANER_PREVIEW_SCREENSHOT,(await win.webContents.capturePage()).toPNG());}
      console.log(JSON.stringify(result));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
