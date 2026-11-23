import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { visibleNotes, sortedNoteFolders, folderTree, folderMove, folderDescendantIds, foldersWithMove } from '../src/features/notes/noteLibrary.mjs';
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
    '\nglobalThis.library = {initializeNoteLibrary,deleteNoteFolder,createNote,reorderNoteFolders,moveNoteFolder,saveNoteFolder,deleteNote,purgeArchivedNotes,prepareNoteLibrary,getNoteCounts};',context);
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

test('folder deletion removes notes beyond loaded pages and counts remain global without downloading bodies', async()=>{
  const f=serviceFixture();
  for(let index=0;index<45;index++) f.documents.set(`notepads/alice/notes/${index}`,{folderId:'study',archived:false,text:'원문'});
  f.documents.set('notepads/alice/notes/other',{folderId:null,archived:false});
  f.documents.set('notepads/alice/notes/trash',{folderId:'study',archived:true});
  f.documents.set('notepads/bob/notes/private',{folderId:'study',archived:false});
  const counts=await f.library.getNoteCounts('alice',['study']);
  assert.equal(counts.all,46);assert.equal(counts.study,45);
  const removed=await f.library.deleteNoteFolder('alice',['study']);
  assert.equal(removed.length,46);
  assert.equal(f.deletions.length,47);
  assert.ok(f.deletions.includes('notepads/alice/notes/trash'));
  assert.ok(!f.deletions.includes('notepads/alice/notes/other'));
  assert.ok(!f.deletions.some(item=>item.startsWith('notepads/bob/')));
  assert.equal(f.deletions.at(-1),'notepads/alice/folders/study');
  assert.deepEqual(f.updates,[]);
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
  const move = folderMove(folders,'c','a','before');
  assert.deepEqual({...move,ids:[...move.ids]},{id:'c',parentId:null,ids:['c','a','b']});
  const ranked = foldersWithMove(folders,move);
  assert.deepEqual(sortedNoteFolders([...ranked,{id:'new',name:'새 폴더'}]).map(item => item.id),['c','a','b','new']);
  assert.deepEqual([...folderMove(ranked,'c','b','after').ids],['a','b','c']);
  assert.equal(folderMove(ranked,'missing','a','before'),null);
  assert.equal(folderMove(ranked,'c','a','before'),null,'A drop that changes nothing is not saved');
});

test('folders nest up to three levels and old folders without parentId stay top-level', () => {
  const folders = [
    {id:'major',name:'전공',sortOrder:0},{id:'math',name:'수학',parentId:'major',sortOrder:0},
    {id:'calc',name:'미적분',parentId:'math',sortOrder:0},{id:'old',name:'예전 폴더'},
    {id:'orphan',name:'고아',parentId:'removed'},{id:'eng',name:'영어',parentId:'major',sortOrder:1},
  ];
  assert.deepEqual(folderTree(folders).map(row => [row.folder.id,row.depth]),
    [['major',1],['math',2],['calc',3],['eng',2],['orphan',1],['old',1]]);
  assert.deepEqual(folderDescendantIds(folders,'major'),['math','calc','eng']);
  assert.deepEqual(folderDescendantIds(folders,'calc'),[]);
  // Into a folder: appended to its children.
  assert.deepEqual({...folderMove(folders,'old','eng','inside'),ids:[...folderMove(folders,'old','eng','inside').ids]},{id:'old',parentId:'eng',ids:['old']});
  assert.deepEqual([...folderMove(folders,'old','major','inside').ids],['math','eng','old']);
  // Reordering beside a nested folder moves into that folder's parent.
  assert.equal(folderMove(folders,'old','calc','before').parentId,'math');
  // A fourth level is refused, both for the folder itself and for a subtree carried along.
  assert.equal(folderMove(folders,'old','calc','inside'),null);
  assert.equal(folderMove(folders,'math','eng','inside'),null);
  assert.equal(folderMove(folders,'major','old','inside'),null);
  // A folder cannot go inside itself or its own descendants.
  assert.equal(folderMove(folders,'major','major','inside'),null);
  assert.equal(folderMove(folders,'major','math','inside'),null);
  assert.equal(folderMove(folders,'major','calc','after'),null);
  // Moving a nested folder out to the top level.
  assert.equal(folderMove(folders,'calc','old','after').parentId,null);
});

test('a corrupted parent cycle still shows every folder exactly once', () => {
  const rows = folderTree([{id:'a',name:'가',parentId:'b'},{id:'b',name:'나',parentId:'a'},{id:'c',name:'다',parentId:'c'}]);
  assert.deepEqual(rows.map(row => row.folder.id).sort(),['a','b','c']);
  assert.ok(rows.every(row => row.depth <= 2));
});

test('folder reordering persists only owner folder metadata and rejects duplicate or malformed ids', async () => {
  const f = serviceFixture();
  await f.library.reorderNoteFolders('alice',['b','a']);
  assert.deepEqual(f.updates.map(item => [item.path,item.data.sortOrder]),[['notepads/alice/folders/b',0],['notepads/alice/folders/a',1]]);
  for (const item of f.updates) assert.deepEqual(Object.keys(item.data).sort(),['sortOrder','updatedAt']);
  await assert.rejects(f.library.reorderNoteFolders('alice',['a','a']));
  await assert.rejects(f.library.reorderNoteFolders('alice',['../bob']));
  f.updates.length = 0;
  await f.library.moveNoteFolder('alice',{id:'a',parentId:'major',ids:['x','a']});
  assert.deepEqual(f.updates.map(item => [item.path,item.data.sortOrder,item.data.parentId]),
    [['notepads/alice/folders/x',0,undefined],['notepads/alice/folders/a',1,'major']]);
  await assert.rejects(f.library.moveNoteFolder('alice',{id:'a',parentId:'../bob',ids:['a']}));
  await assert.rejects(f.library.moveNoteFolder('alice',{id:'a',parentId:null,ids:['b']}));
  await f.library.saveNoteFolder('alice',null,'하위','major');
  assert.equal(f.writes.at(-1).data.parentId,'major');
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

test('deleting a folder removes its subfolders and their notes, and marks the legacy note deleted', async () => {
  const f = serviceFixture();
  f.documents.set('notepads/alice',{uid:'alice',text:'이전 원문',revision:2});
  f.documents.set('notepads/alice/notes/legacy',{folderId:'child',archived:false});
  f.documents.set('notepads/alice/notes/a',{folderId:'study',text:'원문',archived:false});
  f.documents.set('notepads/alice/notes/b',{folderId:'child',archived:true,text:'보관 원문'});
  f.documents.set('notepads/alice/notes/c',{folderId:'other',archived:false});
  const removed = await f.library.deleteNoteFolder('alice',['study','child']);
  assert.deepEqual([...removed].sort(),['a','b','legacy']);
  assert.ok(!f.deletions.includes('notepads/alice/notes/c'));
  assert.deepEqual(f.deletions.slice(-2),['notepads/alice/folders/child','notepads/alice/folders/study']);
  assert.equal(f.documents.get('notepads/alice').deleted,true);
  assert.equal(f.documents.get('notepads/alice').text,'');
  await assert.rejects(f.library.deleteNoteFolder('alice',[]));
  await assert.rejects(f.library.deleteNoteFolder('alice',['../bob']));
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
