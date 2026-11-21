const fs=require('node:fs'),path=require('node:path');
// Note photos in the real editor: paste → stored on "this PC" → shown → reopened → viewer → delete,
// plus the placeholder another device sees. The desktop store is replaced by an in-page fake.
if(!process.versions.electron){
  (async()=>{
    const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
    const root=path.resolve(__dirname,'..'),temporary=path.join(root,'.tmp');fs.mkdirSync(temporary,{recursive:true});
    const profile=fs.mkdtempSync(path.join(temporary,'note-images-'));
    const server=await createServer({configFile:false,root,cacheDir:path.join(profile,'vite-cache'),plugins:[react()],
      optimizeDeps:{entries:['tests/fixtures/note-checklist.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.tmp/**','**/local-data/**']}},clearScreen:false});
    try{
      await server.listen();const env={...process.env,PLANER_IMAGES_PROFILE:profile,PLANER_IMAGES_URL:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/note-checklist.html`};delete env.ELECTRON_RUN_AS_NODE;
      const child=require('node:child_process').spawn(require('electron'),[__filename],{env,stdio:'inherit'}),timeout=setTimeout(()=>child.kill(),60000);
      process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code??1));child.once('error',reject);});clearTimeout(timeout);
    }finally{await server.close();if(path.dirname(profile)===temporary&&path.basename(profile).startsWith('note-images-'))fs.rmSync(profile,{recursive:true,force:true});}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}else{
  const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.PLANER_IMAGES_PROFILE);app.disableHardwareAcceleration();
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    try{
      await win.loadURL(process.env.PLANER_IMAGES_URL);
      await win.webContents.executeJavaScript(`new Promise(resolve=>{const wait=()=>document.querySelector('.notes-text-editor')?resolve():setTimeout(wait,20);wait();})`);
      const press=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await new Promise(resolve=>setTimeout(resolve,100));};
      // Real mouse input: a synthetic click() skips mousedown, where the editor's text selection starts.
      const mouse=async selector=>{
        const [x,y]=await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)];})()`);
        win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});
        await new Promise(resolve=>setTimeout(resolve,150));
      };
      const step=code=>win.webContents.executeJavaScript(`(async()=>{
        const assert=(condition,message)=>{if(!condition)throw Error(message);};
        const wait=async(predicate,message)=>{const start=Date.now();while(!predicate()){if(Date.now()-start>5000)throw Error(message);await new Promise(resolve=>setTimeout(resolve,20));}};
        const editor=()=>document.querySelector('.notes-text-editor'),photo=()=>editor().querySelector('[data-note-image-id]');
        ${code}
      })()`);
      // Fake desktop store: keeps bytes in memory and serves them back as a data URL.
      await step(`
        const stored=new Map();globalThis.savedPhotos=stored;
        window.electronAPI={
          saveNoteImage:async bytes=>{const id=crypto.randomUUID();stored.set(id,new Uint8Array(bytes));return {ok:true,id};},
          readNoteImage:async id=>{const bytes=stored.get(id);if(!bytes)return {ok:false};
            let binary='';bytes.forEach(byte=>{binary+=String.fromCharCode(byte);});return {ok:true,src:'data:image/png;base64,'+btoa(binary)};},
        };
        editor().focus();document.execCommand('insertText',false,'사진 앞');
        const canvas=document.createElement('canvas');canvas.width=120;canvas.height=80;
        const context=canvas.getContext('2d');context.fillStyle='#22c55e';context.fillRect(0,0,120,80);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        const transfer=new DataTransfer();transfer.items.add(new File([blob],'photo.png',{type:'image/png'}));
        editor().dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
        await wait(()=>/\\[사진:[0-9a-f-]{36}\\]/.test(checklistText),'Pasted photo was not saved into the note');
        assert(stored.size===1,'Photo bytes were not handed to the desktop store');
        assert(checklistText.includes('사진 앞'),'Pasting a photo removed the existing text');
        await wait(()=>photo()?.dataset.noteImageReady==='true'&&photo().querySelector('img')?.naturalWidth===120,'Saved photo did not load in the editor');
        // A trailing photo gets a caret slot after it that is not saved as a blank line.
        assert(photo().nextSibling?.matches?.('br[data-note-image-caret]'),'No caret slot after the trailing photo');
        assert(/\\]$/.test(checklistText),'The caret slot was saved as a blank line: '+JSON.stringify(checklistText));
      `);
      await step(`
        const saved=checklistText,previous=photo();document.querySelector('#reopen').click();
        await wait(()=>photo()&&photo()!==previous&&photo().dataset.noteImageReady==='true','Reopened note did not show the stored photo');
        assert(checklistText===saved,'Reopening changed the saved note');
        assert(photo().nextSibling?.matches?.('br[data-note-image-caret]'),'Reopened trailing photo has no caret slot');
      `);
      await mouse('.notes-text-editor [data-note-image-id]');
      await step(`
        assert(document.activeElement===photo(),'One click did not select the photo');
        assert(!document.querySelector('dialog.notes-image-dialog'),'One click opened the viewer');
        const selection=getSelection();assert(!selection.rangeCount||selection.isCollapsed,'Selecting a photo made a text selection');
        assert(!document.querySelector('.notes-floating-toolbar'),'Selecting a photo opened the format toolbar');
      `);
      await mouse('.notes-text-editor [data-note-image-id]');
      await step(`
        const dialog=document.querySelector('dialog.notes-image-dialog');
        assert(dialog?.open&&dialog.querySelector('img')?.alt==='메모 사진','Clicking the selected photo did not open the viewer');
        assert(dialog.querySelector('.notes-image-zoom').textContent==='100%','Viewer does not start at the original size');
        [...dialog.querySelectorAll('button')].find(button=>button.textContent==='+').click();
        assert(dialog.querySelector('.notes-image-zoom').textContent==='125%','Viewer zoom does not work');
        dialog.querySelector('.notes-image-viewer-close').click();
        await wait(()=>!document.querySelector('dialog.notes-image-dialog'),'Viewer did not close');
        editor().focus();getSelection().collapse(editor().firstChild,0);await new Promise(resolve=>setTimeout(resolve,50));
        assert(document.activeElement!==photo(),'Photo stayed selected');
      `);
      await mouse('.notes-text-editor [data-note-image-id]');
      await step(`assert(document.activeElement===photo(),'Clicking the photo again did not select it');`);
      await press('Backspace');
      const afterDelete=await step(`
        await wait(()=>!photo(),'Backspace on a focused photo did not delete it');
        assert(!checklistText.includes('[사진:')&&checklistText.includes('사진 앞'),'Deleting the photo did not update the note');
        return checklistText;
      `);
      await step(`
        // Another device: the note keeps the token but this PC has no file, so the placeholder stays.
        window.electronAPI={readNoteImage:async()=>({ok:false})};
        const id='0f8c2a3e-1b2c-4d5e-8f90-123456789abc';
        document.querySelector('#reset').click();await new Promise(resolve=>setTimeout(resolve,50));
        editor().focus();document.execCommand('insertText',false,'다른 기기 [사진:'+id+':160]');
        await new Promise(resolve=>setTimeout(resolve,50));const typed=editor();document.querySelector('#reopen').click();
        await wait(()=>editor()!==typed&&!!photo(),'Stored photo token did not render as a photo');
        await new Promise(resolve=>setTimeout(resolve,100));
        assert(photo().dataset.noteImageReady===undefined&&!photo().querySelector('img'),'Missing photo was not left as a placeholder');
        assert(getComputedStyle(photo(),'::before').content.includes('첨부한 기기에서만 볼 수 있는 사진'),'Placeholder text is missing');
        assert(photo().dataset.noteImageWidth==='160','Stored photo width was lost');
        photo().click();assert(!document.querySelector('dialog.notes-image-dialog'),'A placeholder opened the viewer');
      `);
      // Delete a photo that starts the note, with no editable text to its left.
      const firstPhotoToken=await step(`
        document.querySelector('#reset').click();await wait(()=>!editor().hasChildNodes(),'Reset did not clear the memo');
        const token='[사진:0f8c2a3e-1b2c-4d5e-8f90-123456789abc]';
        editor().focus();document.execCommand('insertText',false,token+'\\n다음 줄');
        document.querySelector('#reopen').click();
        await wait(()=>editor().firstElementChild?.firstChild===photo(),'Photo is not the first content in the memo');
        return token;
      `);
      await mouse('.notes-text-editor [data-note-image-id]');
      await step(`assert(document.activeElement===photo(),'First photo did not receive focus');`);
      await press('Delete');
      await step(`
        await wait(()=>!photo(),'Delete did not remove the first photo');
        assert(!checklistText.includes('[사진:')&&checklistText.endsWith('다음 줄'),'Deleting the first photo changed the next line');
        assert(document.activeElement===editor(),'Deleting the first photo did not restore focus to the body');
      `);
      await press('Z',['control']);
      await step(`assert(!!photo()&&checklistText.includes(${JSON.stringify(firstPhotoToken)}),'Undo did not restore the first photo');`);
      await step(`
        document.querySelector('#reset').click();await wait(()=>!editor().hasChildNodes(),'Reset did not clear the memo');
        editor().focus();document.execCommand('insertText',false,${JSON.stringify(firstPhotoToken)});
        document.querySelector('#reopen').click();
        await wait(()=>photo()?.nextSibling?.matches?.('br[data-note-image-caret]'),'Only photo did not get its trailing caret slot');
      `);
      await mouse('.notes-text-editor [data-note-image-id]');
      await press('Backspace');
      await step(`
        assert(!photo()&&checklistText==='','Backspace did not clear a memo with just a photo');
        document.execCommand('insertText',false,'새 내용');
        await wait(()=>checklistText==='새 내용','Typing after deleting the only photo did not start a fresh line');
      `);
      if(process.env.PLANER_IMAGES_SCREENSHOT){await new Promise(resolve=>setTimeout(resolve,200));fs.writeFileSync(process.env.PLANER_IMAGES_SCREENSHOT,(await win.webContents.capturePage()).toPNG());}
      console.log(JSON.stringify({paste:true,store:true,reopen:true,viewer:true,deleteKey:true,firstPhotoDelete:true,onlyPhotoBackspace:true,afterDelete:afterDelete.length>0,otherDevicePlaceholder:true}));app.exit(0);
    }catch(error){console.error(error?.stack||String(error));app.exit(1);}
  });
}
