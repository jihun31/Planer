const fs=require('node:fs'),path=require('node:path');
if(!process.versions.electron){
  (async()=>{
    const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
    const root=path.resolve(__dirname,'..'),temporary=path.join(root,'.tmp');fs.mkdirSync(temporary,{recursive:true});
    const profile=fs.mkdtempSync(path.join(temporary,'activity-manager-'));
    const server=await createServer({configFile:false,root,cacheDir:path.join(profile,'vite-cache'),plugins:[react()],
      optimizeDeps:{entries:['tests/fixtures/activity-manager.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.tmp/**','**/local-data/**']}},clearScreen:false});
    try{
      await server.listen();const env={...process.env,PLANER_ACTIVITY_PROFILE:profile,PLANER_ACTIVITY_URL:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/activity-manager.html`};delete env.ELECTRON_RUN_AS_NODE;
      const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'}),timeout=setTimeout(()=>child.kill(),45000);
      process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code??1));child.once('error',reject);});clearTimeout(timeout);
    }finally{await server.close();if(path.dirname(profile)===temporary&&path.basename(profile).startsWith('activity-manager-'))fs.rmSync(profile,{recursive:true,force:true});}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}else{
  const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.PLANER_ACTIVITY_PROFILE);app.disableHardwareAcceleration();
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    try{
      await win.loadURL(process.env.PLANER_ACTIVITY_URL);
      const result=await win.webContents.executeJavaScript(`(async()=>{
        const assert=(value,message)=>{if(!value)throw Error(message);};
        const tick=()=>new Promise(resolve=>setTimeout(resolve,60));
        const wait=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>5000)throw Error('UI timed out');await tick();}};
        await wait(()=>document.querySelectorAll('.act-manager').length===2);
        for(const id of ['study','control']){
          const root=document.getElementById(id),writes=activityManagerWrites[id];
          const form=root.querySelector('.act-add-form'),input=form.querySelector('input'),group=form.querySelector('select');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'새 활동');input.dispatchEvent(new Event('input',{bubbles:true}));
          if(group){group.value='controlled';group.dispatchEvent(new Event('change',{bubbles:true}));}
          await tick();root.querySelector('[title="활동 순서 수정"]').click();await tick();
          assert([...form.elements].every(element=>element.disabled),id+': add controls remain enabled while editing');
          form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();
          assert(writes.adds.length===0,id+': form submission added an activity during editing');
          while(root.querySelector('.act-chip-del')){
            const count=root.querySelectorAll('.act-chip').length;root.querySelector('.act-chip-del').click();
            await wait(()=>root.querySelectorAll('.act-chip').length<count);await tick();
          }
          const done=root.querySelector('[title="순서 변경 완료"]');
          assert(done&&!done.disabled&&root.querySelector('.act-empty'),id+': last deletion hid or disabled Done');
          assert(input.disabled,id+': deletion unexpectedly enabled add before Done');
          done.click();await tick();
          assert(!input.disabled&&!root.querySelector('[title="순서 변경 완료"]'),id+': Done did not exit editing');
          assert(writes.orders.length===1&&writes.orders[0].length===0,id+': deleted activity IDs were saved in the order');
          form.querySelector('[type="submit"]').click();await wait(()=>root.querySelectorAll('.act-chip').length===1);
          assert(writes.adds.length===1&&writes.adds[0].name==='새 활동',id+': adding after Done failed or lost the draft');
          if(group){
            root.querySelector('[title="활동 그룹 변경"]').click();await tick();
            assert([...form.elements].every(element=>element.disabled),'Control group editing allows additions');
            form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();assert(writes.adds.length===1,'Group edit submit bypassed the guard');
            root.querySelector('.clear-external').click();await tick();
            const groupDone=root.querySelector('[title="그룹 변경 완료"]');assert(groupDone,'Group Done disappeared when activities became empty');
            groupDone.click();await tick();assert(!input.disabled,'Group Done did not unlock additions');
          }
        }
        return {studyEditBlocksAdd:true,controlEditBlocksAdd:true,emptyDoneRetained:true,addAfterDone:true,controlGroupEdit:true};
      })()`);
      console.log(JSON.stringify(result));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
