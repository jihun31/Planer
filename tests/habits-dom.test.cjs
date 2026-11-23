const fs=require('node:fs'),path=require('node:path');
// Habit tab and the today block: one-click check, tiny version, celebration, week dots, expandable rows, add form, archive, failures.
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
      await win.webContents.executeJavaScript(`new Promise(resolve=>{const wait=()=>document.querySelector('.habit-row')?resolve():setTimeout(wait,20);wait();})`);
      const step=code=>win.webContents.executeJavaScript(`(async()=>{
        const assert=(condition,message)=>{if(!condition)throw Error(message);};
        const wait=async(predicate,message)=>{const start=Date.now();while(!predicate()){if(Date.now()-start>5000)throw Error(message);await new Promise(resolve=>setTimeout(resolve,20));}};
        const today=()=>document.querySelector('#today');
        const card=name=>[...document.querySelectorAll('.habit-row')].find(item=>item.querySelector('.habit-row-name').textContent.includes(name));
        const dots=name=>[...card(name).querySelectorAll('.habit-day-dot')];
        const cells=name=>dots(name).map(cell=>cell.className.split(' ')[1]);
        const detail=name=>card(name)?.querySelector('.habit-row-detail');
        const openRow=async name=>{if(!detail(name))card(name).querySelector('.habit-row-toggle').click();await wait(()=>detail(name),'Row did not open: '+name);return detail(name);};
        const button=(root,text)=>[...root.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
        const setValue=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
        const lastWrite=()=>JSON.stringify(writes.at(-1));
        ${code}
      })()`);

      // 처음 상태: 17·18일 완료, 19일 빠짐 → 연속 2일. 빠진 날은 빨간 점이 알려 줘서 따로 경고하지 않는다
      await step(`
        assert(today().querySelector('.habit-today-name').textContent.includes('물 마시기'),'Today block does not list the daily habit');
        assert(card('물 마시기').querySelector('.habit-streak').textContent.includes('2일'),'Streak should bridge one miss: '+card('물 마시기').querySelector('.habit-streak')?.textContent);
        assert(!document.querySelector('.habit-warn,.habit-badge,.habit-card'),'Old card pieces should be gone');
        // 설명 문장은 ? 버튼으로 펼친다
        const tab=document.querySelector('#tab');
        assert(!tab.querySelector('.habits-intro'),'Intro should be hidden at first');
        tab.querySelector('[aria-label="습관 설명 보기"]').click();
        await wait(()=>tab.querySelector('.habits-intro'),'? button did not show the intro');
        tab.querySelector('[aria-label="습관 설명 숨기기"]').click();
        await wait(()=>!tab.querySelector('.habits-intro'),'? button did not hide the intro');
        assert(JSON.stringify(cells('물 마시기'))===JSON.stringify(['missed','full','full','missed','open','future','future']),'Week cells: '+JSON.stringify(cells('물 마시기')));
      `);

      // 오늘 탭에서 한 번 클릭 → 완료, 축하 효과, 연속 3일. 다시 누르면 취소
      await step(`
        today().querySelector('.habit-check').click();
        await wait(()=>today().querySelector('.habit-check.full'),'One click did not check the habit');
        assert(lastWrite()===JSON.stringify(['log','water','2026-11-20','full']),'Wrong write: '+lastWrite());
        assert(today().querySelector('.habit-today-item.celebrate .habit-confetti'),'No celebration after checking');
        assert(card('물 마시기').querySelector('.habit-streak').textContent.includes('3일'),'Streak did not grow');
        assert(card('물 마시기').querySelector('.habit-check.full')&&card('물 마시기').classList.contains('full'),'Tab row did not follow the today check');
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
        card('물 마시기').querySelector('[aria-label="물 마시기 기록 취소"]').click();
        await wait(()=>cells('물 마시기')[4]==='open','Card undo did not clear today');
      `);

      // 지난 칸은 눌러서 고칠 수 있다: 빠짐 → 완료 → 최소 → 쉬는 날 → 빈 칸. 미래 칸은 못 누른다
      await step(`
        const thursday=()=>dots('물 마시기')[3];
        assert(thursday().title.startsWith('목요일 11/19'),'Dot title should name the day: '+thursday().title);
        thursday().click();await wait(()=>cells('물 마시기')[3]==='full','Past cell did not become full');
        thursday().click();await wait(()=>cells('물 마시기')[3]==='tiny','Past cell did not become tiny');
        thursday().click();await wait(()=>cells('물 마시기')[3]==='skip','Past cell did not become a rest day');
        thursday().click();await wait(()=>cells('물 마시기')[3]==='missed','Past cell did not clear');
        assert(dots('물 마시기')[5].disabled,'Future cell should not be editable');
      `);

      // 오늘 쉬기: 동그라미가 💤, 연속 기록은 그대로, 동그라미를 다시 누르면 취소
      await step(`
        await wait(()=>!document.querySelector('.celebrate'),'Earlier celebration did not end');
        button(today(),'쉬기').click();
        await wait(()=>today().querySelector('.habit-check.skip'),'Rest day was not recorded from today');
        assert(lastWrite()===JSON.stringify(['log','water','2026-11-20','skip']),'Wrong rest write: '+lastWrite());
        assert(!today().querySelector('.celebrate'),'A rest day should not celebrate');
        assert(card('물 마시기').querySelector('.habit-check.skip'),'Row does not show the rest day');
        assert(card('물 마시기').querySelector('.habit-streak').textContent.includes('2일'),'Rest day changed the streak');
        today().querySelector('.habit-check').click();
        await wait(()=>!today().querySelector('.habit-check.skip'),'Pressing the circle did not cancel the rest day');
      `);

      // 기록: 아래 전체 패널은 모든 습관을 합친 26주, 줄을 펼치면 그 습관의 26주. 한 번에 한 줄만 펼친다
      await step(`
        const panel=()=>document.querySelector('.habit-history-panel');
        assert(panel()&&!panel().querySelector('[role="tab"]'),'Overall panel should have no habit chips');
        assert(panel().querySelectorAll('.habit-bigmap-week').length===26,'Overall heatmap should have 26 weeks');
        assert(panel().querySelectorAll('.habit-bigmap .habit-heat.l4').length>=5,'Overall heatmap misses fully done days');
        assert(panel().querySelector('.habit-bigmap .habit-heat.today'),'Today is not marked');
        assert(/\\d+%/.test(panel().querySelector('.habit-history-stat strong').textContent),'No overall rate');
        assert(!detail('물 마시기'),'Rows should start closed');
        const water=await openRow('물 마시기');
        assert(card('물 마시기').querySelector('.habit-row-toggle').getAttribute('aria-expanded')==='true','Toggle should say it is open');
        assert(water.querySelectorAll('.habit-bigmap-week').length===26,'Row heatmap should have 26 weeks');
        assert(water.querySelectorAll('.habit-bigmap .habit-heat.full').length===5,'Row heatmap misses completed days');
        const gallery=await openRow('갤러리 정리');
        assert(!detail('물 마시기'),'Opening one row should close the other');
        assert(gallery.querySelectorAll('.habit-bigmap .habit-heat.full').length===1,'Gallery heatmap shows the wrong habit');
        card('갤러리 정리').querySelector('.habit-row-toggle').click();
        await wait(()=>!detail('갤러리 정리'),'Second click did not close the row');
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
        assert(card('운동').querySelector('.habit-row-meta').textContent.includes('2026-11-23에 시작해요'),'Future habit should say when it starts');
        assert(!card('운동').querySelector('button.habit-check'),'Not-started habit should have no check button');
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
        card('물 잔').querySelector('[aria-label="물 잔 1 더하기"]').click();await wait(()=>row().textContent.includes('2/3잔'),'Row +1 failed');
        card('물 잔').querySelector('[aria-label="물 잔 1 더하기"]').click();
        await wait(()=>circle().classList.contains('full'),'Reaching the target should complete it');
        assert(card('물 잔').querySelector('.habit-check.full').textContent.trim()==='3','Row circle does not show the met count');
        assert(card('물 잔').querySelector('.habit-row-meta').textContent.includes('하루 3잔'),'Row meta misses the daily target');
        assert(lastWrite()===JSON.stringify(['log','h3','2026-11-20',3]),'Wrong count write: '+lastWrite());
      `);

      // 보관 → 목록에서 빠지고 보관함에, 되돌리기
      await step(`
        (await openRow('운동')).querySelector('[aria-label="수정"]').click();
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

      // 줄 모양: 빈도·트리거는 이름 아래 한 줄, 최소 버전·수정은 펼친 상세에. 오늘 점은 항상 테두리, 기록해도 줄 높이는 그대로
      await step(`
        const water=()=>card('물 마시기');
        assert(water().querySelector('.habit-row-meta').textContent==='매일 · 아침에 일어나서','Meta line: '+water().querySelector('.habit-row-meta').textContent);
        assert(!water().querySelector('[aria-label="수정"]'),'Edit should live in the opened row');
        const opened=await openRow('물 마시기');
        assert(opened.querySelector('.habit-detail-facts').textContent.includes('최소: 한 모금'),'Detail misses the tiny version');
        assert(button(opened,'최소만')&&button(opened,'쉬기')&&!button(opened,'오늘 완료'),'Detail should hold tiny and rest, not a second done button');
        assert(opened.querySelector('[aria-label="수정"]'),'Detail misses the edit button');
        water().querySelector('.habit-row-toggle').click();
        await wait(()=>!detail('물 마시기'),'Row did not close');
        const todayDot=()=>water().querySelector('.habit-day-dot.today i');
        const outline=()=>getComputedStyle(todayDot()).outlineColor;
        const openOutline=outline(),rowHeight=water().offsetHeight;
        assert(getComputedStyle(todayDot()).outlineStyle==='solid','Today dot needs an outline');
        dots('물 마시기')[3].click();
        await wait(()=>cells('물 마시기')[3]==='full','Thursday was not filled');
        water().querySelector('[aria-label="물 마시기 완료"]').click();
        await wait(()=>cells('물 마시기')[4]==='full','Today dot did not fill');
        assert(outline()===openOutline,'Done today should keep the accent outline: '+outline()+' vs '+openOutline);
        assert(water().offsetHeight===rowHeight,'Row height changed: '+water().offsetHeight+' vs '+rowHeight);
        await wait(()=>!document.querySelector('.celebrate'),'Celebration did not end');
        water().querySelector('[aria-label="물 마시기 기록 취소"]').click();
        await wait(()=>cells('물 마시기')[4]==='open','Undo failed');
        // 자주 하는 순서: 매일(물 마시기·물 잔) → 주 3회(운동) → 매월 1일(갤러리)
        const names=[...document.querySelectorAll('.habit-row .habit-row-name')].map(item=>item.lastChild.textContent);
        assert(JSON.stringify(names)===JSON.stringify(['물 마시기','물 잔','운동','갤러리 정리']),'Wrong order: '+JSON.stringify(names));
        // 매월 1일 습관은 주간 점 대신 해야 하는 날 점
        const titles=dots('갤러리 정리').map(item=>item.title.split(' ·')[0]);
        assert(JSON.stringify(titles.slice(0,4))===JSON.stringify(['9/1','10/1','11/1','12/1']),'Gallery dots: '+JSON.stringify(titles));
        assert(JSON.stringify(cells('갤러리 정리').slice(0,4))===JSON.stringify(['missed','full','missed','future']),'Gallery states: '+JSON.stringify(cells('갤러리 정리')));
      `);

      // 자동화 점검: 이번 주에 물어볼 습관을 위쪽 한 줄에 모은다. 나중에는 이번 주 동안 숨김(이 기기),
      // 답하면 저장되고 두 번 연속 4점 이상이면 '자리 잡음'
      await step(`
        const tab=document.querySelector('#tab');
        const panel=()=>tab.querySelector('.habit-auto-panel');
        const item=()=>panel()?.querySelector('[aria-label="물 마시기 자동화 점검"]');
        const openPanel=async()=>{if(!item())panel().querySelector('.habit-auto-toggle').click();await wait(()=>item(),'Self-check line did not open');};
        assert(!card('물 마시기').querySelector('.habit-auto'),'Self-check should not sit inside the row');
        assert(panel()&&panel().textContent.includes('1개'),'Self-check line should count one habit: '+panel()?.textContent);
        assert(!item(),'Self-check line should start folded');
        await openPanel();
        assert(!card('물 마시기').querySelector('.habit-settled'),'One answer is not enough to be settled');
        button(item(),'나중에').click();
        await wait(()=>!panel(),'Later did not hide the self-check');
        assert(localStorage.getItem('planer:habit-auto-later:tester:water:2026-11-16')==='1','Later was not remembered');
        localStorage.removeItem('planer:habit-auto-later:tester:water:2026-11-16');
        await openRow('물 마시기');
        await wait(()=>panel(),'Self-check did not come back');
        await openPanel();
        item().querySelector('[aria-label="4점 대체로 그래요"]').click();
        await wait(()=>!panel(),'Answer did not close the self-check');
        assert(lastWrite()===JSON.stringify(['auto','water','2026-11-16',4]),'Wrong score write: '+lastWrite());
        assert(card('물 마시기').querySelector('.habit-settled'),'Two answers of 4+ should mark the habit settled');
        await wait(()=>detail('물 마시기')?.querySelectorAll('.habit-auto-dot').length===2,'Score trend missing');
        card('물 마시기').querySelector('.habit-row-toggle').click();
        await wait(()=>!detail('물 마시기'),'Row did not close');
      `);

      await step(`
        const tab=document.querySelector('#tab');
        const manage=()=>button(tab,'순서 변경');
        const todayNames=()=>[...today().querySelectorAll('.habit-today-name')].map(row=>row.textContent);
        const orderRows=()=>[...tab.querySelectorAll('.habit-order-list li')];
        assert(manage(),'습관 순서 변경 버튼이 없습니다.');
        assert(todayNames()[1].includes('물 잔'),'오늘의 습관이 기본 순서를 따라야 합니다.');
        manage().click();
        await wait(()=>orderRows().length===4,'순서를 바꿀 습관 목록이 없습니다.');
        assert(orderRows()[0].querySelector('button').disabled,'첫 습관을 더 위로 이동할 수 없어야 합니다.');
        const moveCountHabitToTop=async()=>{
          tab.querySelector('[aria-label="물 잔 위로 이동"]').click();
          await wait(()=>orderRows()[0]?.textContent.includes('물 잔'),'편집 목록에서 물 잔이 위로 이동해야 합니다.');
        };
        await moveCountHabitToTop();
        assert(todayNames()[0].includes('물 마시기'),'저장 전에는 오늘의 습관 순서가 그대로여야 합니다.');
        button(tab,'취소').click();
        await wait(()=>manage(),'순서 편집이 닫혀야 합니다.');
        assert(card('물 마시기')===tab.querySelector('.habit-row'),'취소하면 기존 순서가 보여야 합니다.');

        manage().click();
        await wait(()=>orderRows().length===4,'순서 편집이 다시 열려야 합니다.');
        await moveCountHabitToTop();
        failWrites=true;
        button(tab,'순서 저장').click();
        await wait(()=>tab.querySelector('.habit-error')&&orderRows().length===4&&button(tab,'순서 저장')?.disabled===false,
          '저장에 실패하면 편집을 유지하고 다시 시도할 수 있어야 합니다.');
        assert(todayNames()[0].includes('물 마시기'),'저장 실패 후 오늘의 습관 순서가 그대로여야 합니다.');
        failWrites=false;
        button(tab,'순서 저장').click();
        await wait(()=>manage()&&todayNames()[0].includes('물 잔'),'저장한 순서가 오늘의 습관에 반영되어야 합니다.');
        assert(card('물 잔')===tab.querySelector('.habit-row'),'습관 탭에서도 저장한 순서가 보여야 합니다.');
        assert(todayNames().length===2&&todayNames()[1].includes('물 마시기'),'오늘 예정인 습관만 표시해야 합니다.');
        assert(lastWrite()===JSON.stringify(['order',['h3','water','h2','gallery']]),'바꾼 순서 전체를 저장해야 합니다.');
      `);

      if(process.env.PLANER_HABITS_SHOT){
        // 화면 확인용 캡처: 숨긴 창은 예전 화면이 찍혀서 잠깐 띄운다(포커스는 가져가지 않음)
        await win.webContents.executeJavaScript(`document.querySelector('#tab .habit-row:nth-child(2) .habit-row-toggle').click()`);
        win.showInactive();await new Promise(resolve=>setTimeout(resolve,800));
        fs.writeFileSync(process.env.PLANER_HABITS_SHOT,(await win.webContents.capturePage()).toPNG());
      }
      console.log(JSON.stringify({todayCheck:true,tinyVersion:true,celebration:true,pastCells:true,restDay:true,history:true,weekReview:true,addForm:true,countHabit:true,archive:true,failure:true,rowLayout:true,selfCheck:true,habitOrder:true}));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
