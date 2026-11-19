const fs=require('node:fs'),path=require('node:path');
// Habit tab and the today block: one-click check, tiny version, celebration, week cells, add form, archive, failures.
if(!process.versions.electron){
  (async()=>{
    const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
    const root=path.resolve(__dirname,'..'),temporary=path.join(root,'.tmp');fs.mkdirSync(temporary,{recursive:true});
    const profile=fs.mkdtempSync(path.join(temporary,'habits-'));
    const server=await createServer({configFile:false,root,cacheDir:path.join(profile,'vite-cache'),plugins:[react()],
      optimizeDeps:{entries:['tests/fixtures/habits.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.tmp/**','**/local-data/**']}},clearScreen:false});
    try{
      await server.listen();const env={...process.env,PLANER_HABITS_PROFILE:profile,PLANER_HABITS_URL:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/habits.html`};delete env.ELECTRON_RUN_AS_NODE;
      const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'}),timeout=setTimeout(()=>child.kill(),60000);
      process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code??1));child.once('error',reject);});clearTimeout(timeout);
    }finally{await server.close();if(path.dirname(profile)===temporary&&path.basename(profile).startsWith('habits-'))fs.rmSync(profile,{recursive:true,force:true});}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}else{
  const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.PLANER_HABITS_PROFILE);app.disableHardwareAcceleration();
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    try{
      await win.loadURL(process.env.PLANER_HABITS_URL);
      await win.webContents.executeJavaScript(`new Promise(resolve=>{const wait=()=>document.querySelector('.habit-card')?resolve():setTimeout(wait,20);wait();})`);
      const step=code=>win.webContents.executeJavaScript(`(async()=>{
        const assert=(condition,message)=>{if(!condition)throw Error(message);};
        const wait=async(predicate,message)=>{const start=Date.now();while(!predicate()){if(Date.now()-start>5000)throw Error(message);await new Promise(resolve=>setTimeout(resolve,20));}};
        const today=()=>document.querySelector('#today');
        const card=name=>[...document.querySelectorAll('.habit-card')].find(item=>item.querySelector('.habit-card-title').textContent.includes(name));
        const cells=name=>[...card(name).querySelectorAll('.habit-cell')].map(cell=>cell.className.split(' ')[1]);
        const button=(root,text)=>[...root.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
        const setValue=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
        const lastWrite=()=>JSON.stringify(writes.at(-1));
        ${code}
      })()`);

      // 처음 상태: 17·18일 완료, 19일 빠짐 → 연속 2일 + 안내
      await step(`
        assert(today().querySelector('.habit-today-name').textContent.includes('물 마시기'),'Today block does not list the daily habit');
        assert(card('물 마시기').querySelector('.habit-streak').textContent.includes('2일'),'Streak should bridge one miss: '+card('물 마시기').querySelector('.habit-streak')?.textContent);
        assert(card('물 마시기').querySelector('.habit-warn'),'Missing the never-miss-twice hint');
        assert(JSON.stringify(cells('물 마시기'))===JSON.stringify(['missed','full','full','missed','open','future','future']),'Week cells: '+JSON.stringify(cells('물 마시기')));
      `);

      // 오늘 탭에서 한 번 클릭 → 완료, 축하 효과, 연속 3일. 다시 누르면 취소
      await step(`
        today().querySelector('.habit-check').click();
        await wait(()=>today().querySelector('.habit-check.full'),'One click did not check the habit');
        assert(lastWrite()===JSON.stringify(['log','water','2026-11-20','full']),'Wrong write: '+lastWrite());
        assert(today().querySelector('.habit-today-item.celebrate .habit-confetti'),'No celebration after checking');
        assert(card('물 마시기').querySelector('.habit-streak').textContent.includes('3일'),'Streak did not grow');
        assert(!card('물 마시기').querySelector('.habit-warn'),'Hint should go away once today is done');
        await wait(()=>!today().querySelector('.celebrate'),'Celebration did not end');
        today().querySelector('.habit-check').click();
        await wait(()=>!today().querySelector('.habit-check.full'),'Second click did not undo');
        assert(lastWrite()===JSON.stringify(['log','water','2026-11-20',null]),'Undo wrote: '+lastWrite());
      `);

      // 최소 버전 → ◐, 카드의 오늘 칸도 tiny
      await step(`
        button(today(),'최소만').click();
        await wait(()=>today().querySelector('.habit-check.tiny'),'Tiny version was not recorded');
        assert(cells('물 마시기')[4]==='tiny','Card cell did not follow the tiny log');
        button(card('물 마시기'),'오늘 기록 취소').click();
        await wait(()=>cells('물 마시기')[4]==='open','Card undo did not clear today');
      `);

      // 지난 칸은 눌러서 고칠 수 있다: 빠짐 → 완료 → 최소 → 빈 칸. 미래 칸은 못 누른다
      await step(`
        const thursday=()=>card('물 마시기').querySelectorAll('.habit-cell')[3];
        thursday().click();await wait(()=>cells('물 마시기')[3]==='full','Past cell did not become full');
        thursday().click();await wait(()=>cells('물 마시기')[3]==='tiny','Past cell did not become tiny');
        thursday().click();await wait(()=>cells('물 마시기')[3]==='missed','Past cell did not clear');
        assert(card('물 마시기').querySelectorAll('.habit-cell')[5].disabled,'Future cell should not be editable');
      `);

      // 새 습관: 이름이 없으면 추가 불가, 기본은 주 3회, 다음 월요일부터
      await step(`
        button(document.querySelector('#tab'),'+ 새 습관').click();
        await wait(()=>document.querySelector('.habit-form'),'Form did not open');
        const form=document.querySelector('.habit-form');
        assert(button(form,'추가').disabled,'Empty name should not be addable');
        assert(button(form,'주 N회').getAttribute('aria-pressed')==='true','Default schedule should be weekly');
        setValue(form.querySelector('[aria-label="습관 이름"]'),'운동');
        setValue(form.querySelector('[aria-label="언제 할지"]'),'퇴근하고 집에 오면');
        setValue(form.querySelector('[aria-label="최소 버전"]'),'운동복 입기');
        await new Promise(resolve=>setTimeout(resolve,30));
        assert(form.querySelector('.habit-preview').textContent.includes('퇴근하고 집에 오면 → 운동'),'Preview sentence missing');
        button(form,'다음 월요일').click();await new Promise(resolve=>setTimeout(resolve,30));
        assert(form.querySelector('[aria-label="시작일"]').value==='2026-11-23','Next Monday was not chosen');
        button(form,'추가').click();
        await wait(()=>!document.querySelector('.habit-form')&&card('운동'),'Habit was not added');
        const added=writes.at(-1);
        assert(added[0]==='add'&&added[1].schedule.type==='weekly'&&added[1].schedule.count===3&&added[1].startDate==='2026-11-23'&&added[1].anchor==='퇴근하고 집에 오면','Wrong add: '+JSON.stringify(added));
        assert(card('운동').textContent.includes('2026-11-23에 시작해요'),'Future habit should say when it starts');
        assert(![...today().querySelectorAll('.habit-today-name')].some(item=>item.textContent.includes('운동')),'Not-started habit should not be in today');
      `);

      // 보관 → 목록에서 빠지고 보관함에, 되돌리기
      await step(`
        button(card('운동'),'보관').click();
        await wait(()=>!card('운동')&&document.querySelector('.habits-archive'),'Archive did not move the habit');
        assert(document.querySelector('.habits-archive summary').textContent.includes('1개'),'Archive count wrong');
        button(document.querySelector('.habits-archive'),'되돌리기').click();
        await wait(()=>card('운동')&&!document.querySelector('.habits-archive'),'Restore failed');
      `);

      // 저장 실패는 알리고 화면 상태는 그대로
      await step(`
        failWrites=true;
        today().querySelector('.habit-check').click();
        await wait(()=>today().querySelector('.habit-error'),'Failed write showed no error');
        assert(!today().querySelector('.habit-check.full'),'Failed write still checked the habit');
        failWrites=false;
      `);

      if(process.env.PLANER_HABITS_SHOT){
        await win.webContents.executeJavaScript(`document.querySelector('.habit-check').click()`);
        await new Promise(resolve=>setTimeout(resolve,1200));win.webContents.invalidate();await new Promise(resolve=>setTimeout(resolve,200));
        fs.writeFileSync(process.env.PLANER_HABITS_SHOT,(await win.webContents.capturePage()).toPNG());
      }
      console.log(JSON.stringify({todayCheck:true,tinyVersion:true,celebration:true,pastCells:true,addForm:true,archive:true,failure:true}));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
