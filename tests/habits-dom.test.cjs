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
        card('물 마시기').querySelector('[aria-label="오늘 기록 취소"]').click();
        await wait(()=>cells('물 마시기')[4]==='open','Card undo did not clear today');
      `);

      // 지난 칸은 눌러서 고칠 수 있다: 빠짐 → 완료 → 최소 → 쉬는 날 → 빈 칸. 미래 칸은 못 누른다
      await step(`
        const thursday=()=>card('물 마시기').querySelectorAll('.habit-cell')[3];
        thursday().click();await wait(()=>cells('물 마시기')[3]==='full','Past cell did not become full');
        thursday().click();await wait(()=>cells('물 마시기')[3]==='tiny','Past cell did not become tiny');
        thursday().click();await wait(()=>cells('물 마시기')[3]==='skip','Past cell did not become a rest day');
        assert(!card('물 마시기').querySelector('.habit-warn'),'A rest day yesterday should not warn about a miss');
        thursday().click();await wait(()=>cells('물 마시기')[3]==='missed','Past cell did not clear');
        assert(card('물 마시기').querySelectorAll('.habit-cell')[5].disabled,'Future cell should not be editable');
      `);

      // 오늘 쉬기: 동그라미가 💤, 연속 기록은 그대로, 동그라미를 다시 누르면 취소
      await step(`
        await wait(()=>!document.querySelector('.celebrate'),'Earlier celebration did not end');
        button(today(),'쉬기').click();
        await wait(()=>today().querySelector('.habit-check.skip'),'Rest day was not recorded from today');
        assert(lastWrite()===JSON.stringify(['log','water','2026-11-20','skip']),'Wrong rest write: '+lastWrite());
        assert(!today().querySelector('.celebrate'),'A rest day should not celebrate');
        assert(card('물 마시기').querySelector('.habit-rest-label'),'Card does not show the rest day');
        assert(card('물 마시기').querySelector('.habit-streak').textContent.includes('2일'),'Rest day changed the streak');
        today().querySelector('.habit-check').click();
        await wait(()=>!today().querySelector('.habit-check.skip'),'Pressing the circle did not cancel the rest day');
      `);

      // 기록: 카드에는 없고, 아래 패널에서 습관을 바꿔 가며 26주 히트맵과 달성률을 본다
      await step(`
        assert(!document.querySelector('.habit-card .habit-history-toggle')&&!document.querySelector('.habit-card .habit-bigmap'),'Cards should not hold history');
        const panel=()=>document.querySelector('.habit-history-panel');
        const tab=name=>[...panel().querySelectorAll('[role="tab"]')].find(item=>item.textContent.includes(name));
        assert(panel(),'History panel missing');
        assert(tab('물 마시기').getAttribute('aria-selected')==='true','First habit should be shown first');
        assert(panel().querySelectorAll('.habit-bigmap-week').length===26,'Heatmap should have 26 weeks');
        assert(panel().querySelectorAll('.habit-bigmap .habit-heat.full').length===5,'Heatmap misses completed days');
        assert(panel().querySelector('.habit-bigmap .habit-heat.today'),'Today is not marked');
        assert(/\\d+%/.test(panel().querySelector('.habit-history-stat strong').textContent),'No completion rate');
        tab('갤러리 정리').click();
        await wait(()=>tab('갤러리 정리').getAttribute('aria-selected')==='true','Tab did not switch');
        assert(panel().querySelectorAll('.habit-bigmap .habit-heat.full').length===1,'Switched heatmap shows the wrong habit');
        tab('물 마시기').click();
        await wait(()=>panel().querySelectorAll('.habit-bigmap .habit-heat.full').length===5,'Did not switch back');
      `);

      // 지난주 돌아보기: 11/9~11/15 2/7, 그 전 주 1/7 → 올라감. 닫으면 이번 주 동안 안 보임
      await step(`
        const review=document.querySelector('.habit-review');
        assert(review,'Week review is missing');
        assert(review.textContent.includes('11/9 ~ 11/15'),'Wrong review range: '+review.textContent);
        assert(review.querySelector('.habit-review-num').textContent.includes('2/7'),'Wrong review count');
        assert(review.querySelector('.habit-trend.up'),'Review should show an improvement');
        review.querySelector('[aria-label="지난주 돌아보기 닫기"]').click();
        await wait(()=>!document.querySelector('.habit-review'),'Review did not close');
        assert(localStorage.getItem('planer:habit-review:tester:2026-11-09')==='1','Closing was not remembered');
      `);

      // 새 습관: 이름이 없으면 추가 불가, 기본은 주 3회, 다음 월요일부터
      await step(`
        button(document.querySelector('#tab'),'+ 새 습관').click();
        await wait(()=>document.querySelector('.habit-form'),'Form did not open');
        const form=document.querySelector('.habit-form');
        assert(button(form,'추가').disabled,'Empty name should not be addable');
        assert(button(form,'주 N회').getAttribute('aria-pressed')==='true','Default schedule should be weekly');
        setValue(form.querySelector('[aria-label="습관 이름"]'),'운동');
        // 이모지: 칸을 누르면 고르기 창, 하나 고르면 닫히고 칸에 표시. Esc는 창만 닫고 추가 창은 그대로
        form.querySelector('[aria-label="이모지 고르기"]').click();
        await wait(()=>form.querySelector('.habit-emoji-pop'),'Emoji picker did not open');
        assert(form.querySelectorAll('.habit-emoji-opt').length>=40,'Too few emoji choices');
        form.querySelector('.habit-emoji-pop').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        await wait(()=>!form.querySelector('.habit-emoji-pop'),'Escape did not close the picker');
        assert(document.querySelector('.habit-form'),'Escape in the picker closed the whole form');
        form.querySelector('[aria-label="이모지 고르기"]').click();
        await wait(()=>form.querySelector('.habit-emoji-pop'),'Picker did not reopen');
        form.querySelector('.habit-emoji-opt[aria-label="🏃"]').click();
        await wait(()=>!form.querySelector('.habit-emoji-pop')&&form.querySelector('.habit-emoji-btn').textContent==='🏃','Picked emoji not shown');
        form.querySelector('.habit-emoji-btn').click();
        await wait(()=>form.querySelector('.habit-emoji-pop'),'Picker did not open to change');
        setValue(form.querySelector('[aria-label="이모지 직접 입력"]'),'🥊');
        button(form.querySelector('.habit-emoji-custom'),'넣기').click();
        await wait(()=>form.querySelector('.habit-emoji-btn').textContent==='🥊','Custom emoji not used');
        setValue(form.querySelector('[aria-label="언제 할지"]'),'퇴근하고 집에 오면');
        setValue(form.querySelector('[aria-label="최소 버전"]'),'운동복 입기');
        await new Promise(resolve=>setTimeout(resolve,30));
        assert(form.querySelector('.habit-preview').textContent.includes('퇴근하고 집에 오면 → 운동'),'Preview sentence missing');
        button(form,'다음 월요일').click();await new Promise(resolve=>setTimeout(resolve,30));
        assert(form.querySelector('[aria-label="시작일"]').value==='2026-11-23','Next Monday was not chosen');
        button(form,'추가').click();
        await wait(()=>!document.querySelector('.habit-form')&&card('운동'),'Habit was not added');
        const added=writes.at(-1);
        assert(added[0]==='add'&&added[1].schedule.type==='weekly'&&added[1].schedule.count===3&&added[1].startDate==='2026-11-23'&&added[1].anchor==='퇴근하고 집에 오면'&&added[1].emoji==='🥊','Wrong add: '+JSON.stringify(added));
        assert(card('운동').textContent.includes('2026-11-23에 시작해요'),'Future habit should say when it starts');
        assert(![...today().querySelectorAll('.habit-today-name')].some(item=>item.textContent.includes('운동')),'Not-started habit should not be in today');
      `);

      // 횟수 습관: 오늘부터 하루 8잔. 동그라미 = +1, 1번이면 최소(축하), 목표 달성은 완료
      await step(`
        button(document.querySelector('#tab'),'+ 새 습관').click();
        await wait(()=>document.querySelector('.habit-form'),'Form did not open');
        const form=document.querySelector('.habit-form');
        setValue(form.querySelector('[aria-label="습관 이름"]'),'물 잔');
        button(form,'하루 횟수 채우기').click();
        await wait(()=>form.querySelector('[aria-label="하루 횟수"]'),'Count input missing');
        assert(!form.querySelector('[aria-label="최소 버전"]'),'Count habits should not ask for a tiny version');
        setValue(form.querySelector('[aria-label="하루 횟수"]'),'3');
        setValue(form.querySelector('[aria-label="단위"]'),'잔');
        button(form,'매일').click();
        await new Promise(resolve=>setTimeout(resolve,30));
        button(form,'추가').click();
        await wait(()=>!document.querySelector('.habit-form')&&card('물 잔'),'Count habit was not added');
        assert(JSON.stringify(writes.at(-1)[1].target)===JSON.stringify({type:'count',value:3,unit:'잔'}),'Wrong target: '+JSON.stringify(writes.at(-1)));
        const row=()=>[...today().querySelectorAll('.habit-today-item')].find(item=>item.textContent.includes('물 잔'));
        const circle=()=>row().querySelector('.habit-check');
        circle().click();
        await wait(()=>row().textContent.includes('1/3잔'),'+1 did not count');
        assert(circle().classList.contains('tiny')&&row().classList.contains('celebrate'),'First count should be tiny and celebrated');
        circle().click();await wait(()=>row().textContent.includes('2/3잔'),'Second +1 failed');
        row().querySelector('[aria-label="물 잔 1 빼기"]').click();
        await wait(()=>row().textContent.includes('1/3잔'),'-1 failed');
        button(card('물 잔'),'+1').click();await wait(()=>row().textContent.includes('2/3잔'),'Card +1 failed');
        button(card('물 잔'),'+1').click();
        await wait(()=>circle().classList.contains('full'),'Reaching the target should complete it');
        assert(card('물 잔').querySelector('.habit-count.habit-met').textContent.includes('3/3잔'),'Card does not show the met target');
        assert(lastWrite()===JSON.stringify(['log','h3','2026-11-20',3]),'Wrong count write: '+lastWrite());
      `);

      // 보관 → 목록에서 빠지고 보관함에, 되돌리기
      await step(`
        card('운동').querySelector('[aria-label="수정"]').click();
        await wait(()=>document.querySelector('.habit-form'),'Edit form did not open');
        button(document.querySelector('.habit-form'),'보관').click();
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
        assert(!today().querySelector('.habit-check').classList.contains('full'),'Failed write still checked the habit');
        failWrites=false;
      `);

      // 카드 모양: 오늘 칸은 상태와 관계없이 강조 테두리, 기록해도 아래 줄 높이는 그대로, 트리거·최소 버전은 한 줄
      await step(`
        const water=()=>card('물 마시기');
        assert(!document.querySelector('.habit-badges'),'Badges should be gone');
        assert(water().querySelector('.habit-info').textContent.replace(/\\s+/g,' ').includes('⏰ 아침에 일어나서')&&water().querySelector('.habit-info').textContent.includes('최소: 한 모금'),'Info line: '+water().querySelector('.habit-info').textContent);
        assert(!water().querySelector('.habit-info').textContent.includes('→'),'Anchor line should not repeat the name');
        assert(!button(water(),'보관')&&water().querySelector('.habit-edit-btn[aria-label="수정"]'),'Card should only have the pencil button');
        const todayCell=()=>water().querySelector('.habit-cell.today');
        const border=()=>getComputedStyle(todayCell()).borderTopColor;
        assert(todayCell().querySelector('.habit-cell-mark').textContent==='○','Open today should be ○');
        const openBorder=border(),footHeight=water().querySelector('.habit-card-foot').offsetHeight;
        water().querySelectorAll('.habit-cell')[3].click();
        await wait(()=>cells('물 마시기')[3]==='full','Thursday was not filled');
        button(water(),'오늘 완료').click();
        await wait(()=>water().querySelector('.habit-state-label.full'),'Done label missing');
        assert(todayCell().querySelector('.habit-cell-mark').textContent==='●'&&border()===openBorder,'Done today should keep the accent border: '+border()+' vs '+openBorder);
        assert(water().querySelector('.habit-card-foot').offsetHeight===footHeight,'Footer height changed: '+water().querySelector('.habit-card-foot').offsetHeight+' vs '+footHeight);
        await wait(()=>!document.querySelector('.celebrate'),'Celebration did not end');
        water().querySelector('[aria-label="오늘 기록 취소"]').click();
        await wait(()=>cells('물 마시기')[4]==='open','Undo failed');
        // 자주 하는 순서: 매일(물 마시기·물 잔) → 주 3회(운동) → 매월 1일(갤러리)
        const names=[...document.querySelectorAll('.habit-card .habit-card-name')].map(item=>item.textContent);
        assert(JSON.stringify(names)===JSON.stringify(['물 마시기','물 잔','운동','갤러리 정리']),'Wrong order: '+JSON.stringify(names));
        // 매월 1일 습관은 주간 칸 대신 해야 하는 날 칸
        const gallery=card('갤러리 정리');
        const labels=[...gallery.querySelectorAll('.habit-cell-day')].map(item=>item.textContent);
        assert(JSON.stringify(labels.slice(0,4))===JSON.stringify(['9/1','10/1','11/1','12/1']),'Gallery cells: '+JSON.stringify(labels));
        assert(JSON.stringify(cells('갤러리 정리').slice(0,4))===JSON.stringify(['missed','full','missed','future']),'Gallery states: '+JSON.stringify(cells('갤러리 정리')));
      `);

      // 자동화 점검: 나중에는 이번 주 동안 숨김(이 기기), 답하면 저장되고 두 번 연속 4점 이상이면 '자리 잡음'
      await step(`
        const water=()=>card('물 마시기');
        const auto=()=>water().querySelector('.habit-auto');
        assert(auto(),'Self-check should be asked this week');
        assert(!water().querySelector('.habit-settled'),'One answer is not enough to be settled');
        button(auto(),'나중에').click();
        await wait(()=>!auto(),'Later did not hide the self-check');
        assert(localStorage.getItem('planer:habit-auto-later:tester:water:2026-11-16')==='1','Later was not remembered');
        localStorage.removeItem('planer:habit-auto-later:tester:water:2026-11-16');
        water().querySelector('[aria-label="수정"]').click();
        await wait(()=>document.querySelector('.habit-form'),'Edit form did not open');
        button(document.querySelector('.habit-form'),'보관').click();
        await wait(()=>!water()&&!document.querySelector('.habit-form'),'Archive failed');
        button(document.querySelector('.habits-archive'),'되돌리기').click();
        await wait(()=>water()&&auto(),'Self-check did not come back');
        auto().querySelector('[aria-label="4점 대체로 그래요"]').click();
        await wait(()=>!auto(),'Answer did not close the self-check');
        assert(lastWrite()===JSON.stringify(['auto','water','2026-11-16',4]),'Wrong score write: '+lastWrite());
        assert(water().querySelector('.habit-settled'),'Two answers of 4+ should mark the habit settled');
        await wait(()=>document.querySelectorAll('.habit-history-panel .habit-auto-dot').length===2,'Score trend missing');
      `);

      if(process.env.PLANER_HABITS_SHOT){
        // 화면 확인용 캡처: 숨긴 창은 예전 화면이 찍혀서 잠깐 띄운다(포커스는 가져가지 않음)
        win.showInactive();await new Promise(resolve=>setTimeout(resolve,800));
        fs.writeFileSync(process.env.PLANER_HABITS_SHOT,(await win.webContents.capturePage()).toPNG());
      }
      console.log(JSON.stringify({todayCheck:true,tinyVersion:true,celebration:true,pastCells:true,restDay:true,history:true,weekReview:true,addForm:true,countHabit:true,archive:true,failure:true,cardLayout:true,selfCheck:true}));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
