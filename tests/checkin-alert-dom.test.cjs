const fs=require('node:fs'),path=require('node:path');
if(!process.versions.electron){
  (async()=>{
    const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
    const root=path.resolve(__dirname,'..'),temporary=path.join(root,'.tmp');fs.mkdirSync(temporary,{recursive:true});
    const profile=fs.mkdtempSync(path.join(temporary,'checkin-alert-'));
    const stub=path.join(root,'tests/fixtures/discord-service-stub.mjs');
    const server=await createServer({configFile:false,root,cacheDir:path.join(profile,'vite-cache'),plugins:[{
      name:'discord-service-stub',enforce:'pre',resolveId(source){if(source.endsWith('/features/discord/discordService'))return stub;},
    },react()],optimizeDeps:{entries:['tests/fixtures/checkin-alert.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.tmp/**','**/local-data/**']}},clearScreen:false});
    try{
      await server.listen();const env={...process.env,PLANER_SETTINGS_PROFILE:profile,PLANER_SETTINGS_URL:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/checkin-alert.html`};delete env.ELECTRON_RUN_AS_NODE;
      const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'}),timeout=setTimeout(()=>child.kill(),45000);
      process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code??1));child.once('error',reject);});clearTimeout(timeout);
    }finally{await server.close();if(path.dirname(profile)===temporary&&path.basename(profile).startsWith('checkin-alert-'))fs.rmSync(profile,{recursive:true,force:true});}
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
        const hour=()=>document.querySelector('[aria-label="인증 알림 시"]'),minute=()=>document.querySelector('[aria-label="인증 알림 분"]');
        const leave=input=>input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
        const saved=()=>localStorage.getItem('planer:checkin-alert:alert-user');
        const type=(input,value)=>{input.focus();const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
        await wait(()=>hour(),'Alert time fields did not render');
        assert(hour().value==='00'&&minute().value==='30','Default is not 00:30: '+hour().value+':'+minute().value);
        assert(hour().type==='text'&&minute().type==='text','Fields are not typed text boxes');
        type(hour(),'23');await tick();
        assert(saved()==='23:30','23 was not saved: '+saved());
        type(minute(),'5');await tick();leave(minute());await tick();
        assert(saved()==='23:05'&&minute().value==='05','Single-digit minute not padded: '+saved()+' '+minute().value);
        type(hour(),'7a');await tick();
        assert(hour().value==='7'&&saved()==='07:05','Non-digits not dropped: '+hour().value+' '+saved());
        type(hour(),'25');await tick();
        assert(saved()==='07:05','Invalid hour was saved: '+saved());
        leave(hour());await tick();
        assert(hour().value==='07','Invalid hour not reverted on blur: '+hour().value);
        const toggle=document.querySelector('.checkin-alert-setting input[type="checkbox"]');
        toggle.click();await tick();
        assert(saved()==='off'&&!hour(),'Turning off did not hide the fields');
        toggle.click();await tick();
        assert(saved()==='07:05'&&hour().value==='07','Turning back on lost the time: '+saved());
        return {default0030:true,typing:true,padding:true,invalidReverts:true,toggle:true};
      }catch(error){return {failure:String(error&&error.stack||error)};}})()`);
      if(result.failure)throw Error(result.failure);
      console.log(JSON.stringify(result));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
