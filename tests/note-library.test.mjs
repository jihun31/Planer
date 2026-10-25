import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { visibleNotes, sortedNoteFolders, movedFolderIds } from '../src/features/notes/noteLibrary.mjs';
import { createNotepadStore } from '../src/features/notes/notepadStore.mjs';

const strip = source => source.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?/g,'').replace(/export\s+(?=(?:async )?(?:const|function))/g,'');
function serviceFixture() {
  const documents = new Map(), updates = [], writes = [], deletions = [], reads = [], queries = [];
  const db = {};
  const transaction = {
    get:async ref => {reads.push(ref.path);return {exists:() => documents.has(ref.path),data:() => documents.get(ref.path)};},
    set:(ref,data) => {writes.push({path:ref.path,data});documents.set(ref.path,data);},
    update:(ref,data) => updates.push({path:ref.path,data}),
    delete:ref => {deletions.push(ref.path);documents.delete(ref.path);},
  };
  const context = vm.createContext({db,MAX_NOTE_LENGTH:50000,
    collection:(_db,...parts) => ({path:parts.join('/')}),
    doc:(base,...parts) => ({path:base === db ? parts.join('/') : `${base.path}/${parts[0] || 'new-id'}`,id:parts.at(-1) || 'new-id'}),
    serverTimestamp:() => 'timestamp',
    runTransaction:(_db,fn) => fn(transaction),
    query:(ref,...filters) => ({...ref,filters}),where:(field,op,value) => ({field,op,value}),
    getDocs:async ref => {queries.push(ref);return {docs:[...documents].filter(([path,data]) => path.startsWith(ref.path + '/') && (!ref.filters || ref.filters.every(f => data[f.field] === f.value)))
      .map(([path,data]) => ({id:path.split('/').at(-1),data:()=>data}))};},
    getCountFromServer:async ref => {queries.push(ref);return {data:()=>({count:[...documents].filter(([path,data])=>
      path.startsWith(ref.path + '/') && ref.filters.every(f=>data[f.field] === f.value)).length})};},
    getNoteLibrarySnapshot:async uid => [...documents].filter(([path]) => path.startsWith(`notepads/${uid}/notes/`))
      .map(([path,data]) => ({...data,id:path.split('/').at(-1)})),
    writeBatch:() => ({update:(ref,data) => updates.push({path:ref.path,data}),delete:ref => deletions.push(ref.path),commit:async () => {}}),
    setDoc:async (ref,data) => writes.push({path:ref.path,data}),
    updateDoc:async (ref,data) => updates.push({path:ref.path,data}),
  });
  vm.runInContext(strip(fs.readFileSync('src/features/notes/noteLibraryService.js','utf8')) +
    '\nglobalThis.library = {initializeNoteLibrary,deleteNoteFolder,createNote,reorderNoteFolders,deleteNote,purgeArchivedNotes,prepareNoteLibrary,getNoteCounts};',context);
  vm.runInContext(strip(fs.readFileSync('src/features/notes/notepadService.js','utf8')) +
    '\nglobalThis.saveBody = saveNotepad;',context);
  return {documents,updates,writes,deletions,reads,queries,library:context.library,saveBody:context.saveBody};
}

test('paginated startup reuses legacy metadata and checks archived records beyond the current page', async()=>{
  const f=serviceFixture();
  f.documents.set('notepads/alice/notes/legacy',{text:'',archived:false});
  f.documents.set('notepads/alice/notes/a',{text:'원문',archived:false});
  f.documents.set('notepads/bob/notes/other',{text:'다른 계정',archived:true});
  const result=await f.library.prepareNoteLibrary('alice',false);
  assert.equal(result.legacyDeleted,false);assert.deepEqual(Array.from(result.removed),[]);
  assert.deepEqual(f.reads,[]);assert.equal(f.queries.length,1);assert.deepEqual(f.writes,[]);
  assert.equal(f.queries[0].filters[0].field,'archived');assert.equal(f.queries[0].filters[0].value,true);
  f.documents.set('notepads/alice/notes/trash',{text:'이전 휴지통',archived:true});
  const cleaned=await f.library.prepareNoteLibrary('alice',false);
  assert.deepEqual(Array.from(cleaned.removed),['trash']);
  assert.deepEqual(f.reads,['notepads/alice/notes/trash']);
  assert.equal(f.queries.length,2);
  assert.ok(f.documents.has('notepads/alice/notes/a'));assert.ok(f.documents.has('notepads/bob/notes/other'));
});

test('folder deletion moves notes beyond loaded pages and counts remain global without downloading bodies', async()=>{
  const f=serviceFixture();
  for(let index=0;index<45;index++) f.documents.set(`notepads/alice/notes/${index}`,{folderId:'study',archived:false,text:'원문'});
  f.documents.set('notepads/alice/notes/other',{folderId:null,archived:false});
  f.documents.set('notepads/alice/notes/trash',{folderId:'study',archived:true});
  f.documents.set('notepads/bob/notes/private',{folderId:'study',archived:false});
  const counts=await f.library.getNoteCounts('alice',['study']);
  assert.equal(counts.all,46);assert.equal(counts.study,45);
  await f.library.deleteNoteFolder('alice','study');
  assert.equal(f.updates.length,46);
  assert.ok(f.updates.every(item=>item.path.startsWith('notepads/alice/notes/') && item.data.folderId === null));
  assert.ok(f.updates.every(item=>!('text' in item.data)));
});

test('saving note text reuses counts; changed membership, explicit retry and a different account refresh them', async()=>{
  const source=fs.readFileSync('src/features/notes/useNoteLibrary.js','utf8');
  const effect=source.slice(source.indexOf('  useEffect(()=>{'),source.indexOf('  useEffect(() => {'));
  const reads=[],states=[];let cleanup,scheduled;
  const context=vm.createContext({uid:'alice',notesReady:true,foldersReady:true,page:{serverReady:true},
    folderKey:'study',membershipKey:'a:study',listeners:{},countRequest:{current:null},
    getNoteCounts:async(uid,ids)=>{reads.push({uid,ids});return {all:20,study:20};},
    setCountState:value=>states.push(value),setTimeout:fn=>{scheduled=fn;return 1;},clearTimeout:()=>{scheduled=null;},
    useEffect:fn=>{cleanup=fn();},
  });
  const render=async()=>{cleanup?.();vm.runInContext(effect,context);scheduled?.();await Promise.resolve();await Promise.resolve();};
  await render();assert.equal(reads.length,1);
  context.page={serverReady:false};await render();
  context.page={serverReady:true};await render();assert.equal(reads.length,1,'A save acknowledgement must not repeat every folder count query');
  context.membershipKey='a:study|b:study';await render();assert.equal(reads.length,2);
  context.listeners={};await render();assert.equal(reads.length,3);
  context.uid='bob';await render();assert.equal(reads.length,4);assert.equal(states.at(-1).uid,'bob');cleanup?.();
});

test('all notes include folderless and orphaned notes while archived records stay hidden until purged', () => {
  const notes = [
    {id:'a',title:'수학',folderId:'study',archived:false},
    {id:'b',title:'독서',folderId:null,archived:false},
    {id:'c',title:'영어',folderId:'removed',archived:false},
    {id:'d',title:'지난 메모',folderId:'study',archived:true},
  ];
  assert.deepEqual(visibleNotes(notes,'all').map(note => note.id),['a','b','c']);
  assert.deepEqual(visibleNotes(notes,'study').map(note => note.id),['a']);
  assert.deepEqual(visibleNotes(notes,'all','독서').map(note => note.id),['b']);
});

test('permanent deletion removes only the selected note; archived cleanup excludes other owners and active notes', async () => {
  const f = serviceFixture();
  f.documents.set('notepads/alice/notes/a',{archived:false,text:'지울 메모'});
  f.documents.set('notepads/alice/notes/trash',{archived:true,text:'과거 휴지통'});
  f.documents.set('notepads/alice/notes/keep',{archived:false,text:'유지'});
  f.documents.set('notepads/bob/notes/trash',{archived:true,text:'다른 계정'});
  await f.library.deleteNote('alice','a');
  assert.deepEqual(f.deletions,['notepads/alice/notes/a']);
  assert.deepEqual(Array.from(await f.library.purgeArchivedNotes('alice')),['trash']);
  assert.ok(f.documents.has('notepads/alice/notes/keep'));
  assert.ok(f.documents.has('notepads/bob/notes/trash'));
  assert.equal(await f.library.deleteNote('alice','keep',true),false);
});

test('deleting the legacy note erases its body and prevents stale drafts or saves from recreating it', async () => {
  const f = serviceFixture();
  f.documents.set('notepads/alice',{uid:'alice',text:'이전 원문',revision:4});
  f.documents.set('notepads/alice/notes/legacy',{archived:true});
  await f.library.deleteNote('alice','legacy');
  assert.equal(f.documents.get('notepads/alice').text,'');
  assert.equal(f.documents.get('notepads/alice').deleted,true);
  assert.equal(f.documents.has('notepads/alice/notes/legacy'),false);
  const result = await f.library.initializeNoteLibrary('alice',true);
  assert.equal(result.legacyDeleted,true);
  assert.equal(f.documents.has('notepads/alice/notes/legacy'),false);
  await assert.rejects(f.saveBody('alice','되살릴 수 없음',5,'legacy'),error => error.code === 'notepad/deleted');
});

test('folder order retains legacy alphabetical order, supports dropping on either side, and appends unranked folders', () => {
  const folders = [{id:'b',name:'나'},{id:'a',name:'가'},{id:'c',name:'다'}];
  assert.deepEqual(sortedNoteFolders(folders).map(item => item.id),['a','b','c']);
  const next = movedFolderIds(sortedNoteFolders(folders),'c','a',false);
  assert.deepEqual(next,['c','a','b']);
  const ranked = folders.map(item => ({...item,sortOrder:next.indexOf(item.id)}));
  assert.deepEqual(sortedNoteFolders([...ranked,{id:'new',name:'새 폴더'}]).map(item => item.id),['c','a','b','new']);
  assert.deepEqual(movedFolderIds(sortedNoteFolders(ranked),'c','b',true),['a','b','c']);
  assert.deepEqual(movedFolderIds(ranked,'missing','a',false),folders.map(item => item.id));
});

test('folder reordering persists only owner folder metadata and rejects duplicate or malformed ids', async () => {
  const f = serviceFixture();
  await f.library.reorderNoteFolders('alice',['b','a']);
  assert.deepEqual(f.updates.map(item => [item.path,item.data.sortOrder]),[['notepads/alice/folders/b',0],['notepads/alice/folders/a',1]]);
  for (const item of f.updates) assert.deepEqual(Object.keys(item.data).sort(),['sortOrder','updatedAt']);
  await assert.rejects(f.library.reorderNoteFolders('alice',['a','a']));
  await assert.rejects(f.library.reorderNoteFolders('alice',['../bob']));
});

test('legacy migration adds only one library entry and preserves both old cloud text and metadata', async () => {
  const f = serviceFixture();
  f.documents.set('notepads/alice',{uid:'alice',text:'기존 원문',revision:3});
  await f.library.initializeNoteLibrary('alice',true);
  assert.equal(f.writes.length,1);
  assert.equal(f.writes[0].path,'notepads/alice/notes/legacy');
  assert.equal(f.documents.get('notepads/alice').text,'기존 원문');
  f.documents.get('notepads/alice/notes/legacy').title = '바꾼 제목';
  f.documents.get('notepads/alice/notes/legacy').archived = true;
  await f.library.initializeNoteLibrary('alice',true);
  assert.equal(f.writes.length,1);
  assert.equal(f.documents.get('notepads/alice/notes/legacy').title,'바꾼 제목');
  const fresh = serviceFixture(); await fresh.library.initializeNoteLibrary('bob',false);
  assert.equal(fresh.writes.length,0);
  await fresh.library.initializeNoteLibrary('bob',true);
  assert.equal(fresh.writes[0].path,'notepads/bob/notes/legacy');
});

test('deleting a folder moves active and trashed notes without touching their bodies or revisions', async () => {
  const f = serviceFixture();
  await f.library.deleteNoteFolder('alice','study',[
    {id:'a',folderId:'study',text:'원문',revision:4},
    {id:'b',folderId:'study',archived:true,text:'보관 원문',revision:6},
    {id:'c',folderId:'other'},
  ]);
  assert.deepEqual(f.updates.map(item => item.path),['notepads/alice/notes/a','notepads/alice/notes/b']);
  for (const item of f.updates) {
    assert.equal(item.data.folderId,null);
    assert.deepEqual(Object.keys(item.data).sort(),['folderId','updatedAt']);
  }
  assert.deepEqual(f.deletions,['notepads/alice/folders/study']);
});

test('body saves preserve title and folder metadata, and keep legacy writes on the original path', async () => {
  const f = serviceFixture();
  f.documents.set('notepads/alice/notes/a',{text:'원문',revision:2,title:'제목',folderId:'study'});
  await f.saveBody('alice','새 원문',2,'a');
  assert.equal(f.updates[0].path,'notepads/alice/notes/a');
  assert.deepEqual(Object.keys(f.updates[0].data).sort(),['revision','text','updatedAt']);
  await assert.rejects(f.saveBody('alice','충돌',1,'a'),error => error.code === 'notepad/conflict');
  f.documents.set('notepads/alice',{text:'이전 메모',revision:3});
  await f.saveBody('alice','기존 메모 수정',3,'legacy');
  assert.equal(f.writes[0].path,'notepads/alice');
});

test('local drafts are isolated per note and account while the original draft key remains usable', t => {
  const disk = new Map([['planer:notepad-draft:alice',JSON.stringify({text:'기존 초안',revision:0})]]);
  const storage = {getItem:key => disk.get(key),setItem:(key,value) => disk.set(key,value),removeItem:key => disk.delete(key)};
  const make = (uid,noteId) => {
    const store = createNotepadStore({uid,noteId,storage,delay:60000,
      subscribe:(_uid,cb) => {cb({text:'',revision:0});return()=>{};},save:async()=>1});
    t.after(store.start());return store;
  };
  const legacy = make('alice','legacy'); assert.equal(legacy.getSnapshot().text,'기존 초안');
  const a = make('alice','a'), b = make('alice','b'), other = make('bob','a');
  a.edit('第一 메모');b.edit('두 번째 메모');
  assert.equal(other.getSnapshot().text,'');
  assert.equal(JSON.parse(disk.get('planer:notepad-draft:alice:a')).text,'第一 메모');
  assert.equal(JSON.parse(disk.get('planer:notepad-draft:alice:b')).text,'두 번째 메모');
});
