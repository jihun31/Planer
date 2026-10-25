import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createNoteSnapshotHub } from '../src/features/notes/noteSnapshotHub.mjs';
import { createNotepadStore, noteDraftKey } from '../src/features/notes/notepadStore.mjs';

function fixture({withBodies=false}={}) {
  const connections=[];
  const bodies=[];
  const hub=createNoteSnapshotHub((uid,next,error,options)=>{
    const connection={uid,next,error,options,stopped:false};connections.push(connection);
    return ()=>{connection.stopped=true;};
  },withBodies ? {listenBody:(uid,id,next,error)=>{
    const connection={uid,id,next,error,stopped:false};bodies.push(connection);
    return ()=>{connection.stopped=true;};
  }} : {});
  const snapshot=(records,{fromCache=false,pending=[]}={})=>({
    metadata:{fromCache,hasPendingWrites:pending.length > 0},
    docs:records.map(({id,...data})=>({id,data:()=>data,metadata:{hasPendingWrites:pending.includes(id)}})),
  });
  return {hub,connections,bodies,snapshot};
}

const rows=(start,count)=>Array.from({length:count},(_,index)=>({id:`n${start+index}`,title:`제목 ${start+index}`,
  text:`본문 ${start+index}`,revision:1,folderId:'study',updatedAt:{seconds:1000-start-index,nanoseconds:0}}));

test('the first view fetches twenty notes; More uses a cursor and never refetches preceding pages', ()=>{
  const f=fixture(),states=[];
  f.hub.subscribePage('alice',state=>states.push(state));
  assert.equal(f.connections[0].options.pageSize,20);assert.equal(f.connections[0].options.cursor,null);
  f.connections[0].next(f.snapshot(rows(0,20)));
  assert.equal(states.at(-1).notes.length,20);assert.equal(states.at(-1).hasMore,true);
  f.hub.loadMore('alice');f.hub.loadMore('alice');
  assert.equal(f.connections.length,2,'Repeated clicks must not duplicate the next page');
  assert.equal(f.connections[1].options.cursor.id,'n19');assert.equal(states.at(-1).loadingMore,true);
  f.connections[1].next(f.snapshot(rows(20,20)));
  assert.equal(states.at(-1).notes.length,40);
  f.hub.loadMore('alice');assert.equal(f.connections[2].options.cursor.id,'n39');
  f.connections[2].next(f.snapshot(rows(40,3)));
  assert.equal(states.at(-1).notes.length,43);assert.equal(states.at(-1).hasMore,false);
  f.hub.loadMore('alice');assert.equal(f.connections.length,3);
});

test('page boundaries follow edits and new notes without gaps, duplicates or stale callbacks', ()=>{
  const f=fixture(),states=[];
  f.hub.subscribePage('alice',state=>states.push(state));
  f.connections[0].next(f.snapshot(rows(0,20)));f.hub.loadMore('alice');
  f.connections[1].next(f.snapshot(rows(20,20)));
  const newNote={...rows(0,1)[0],id:'new',updatedAt:{seconds:2000,nanoseconds:0}};
  f.connections[0].next(f.snapshot([newNote,...rows(0,19)]));
  assert.equal(f.connections[1].stopped,true);assert.equal(f.connections[2].options.cursor.id,'n18');
  f.connections[2].next(f.snapshot(rows(19,20)));
  assert.equal(states.at(-1).notes.length,40);
  assert.equal(new Set(states.at(-1).notes.map(note=>note.id)).size,40);
  assert.ok(states.at(-1).notes.some(note=>note.id==='n19'));
  f.connections[1].next(f.snapshot([{id:'stale'}]));
  assert.ok(!states.at(-1).notes.some(note=>note.id==='stale'));
});

test('folder pages and whole-title search use separate scopes and retain opened editor metadata', ()=>{
  const f=fixture(),states=[];
  f.hub.subscribePage('alice',state=>states.push(state));
  f.connections[0].next(f.snapshot(rows(0,20)));
  f.hub.setView('alice','other',false);
  assert.equal(f.connections[0].stopped,true);assert.equal(f.connections[1].options.folder,'other');
  f.connections[1].next(f.snapshot([{...rows(90,1)[0],folderId:'other'}]));
  assert.equal(states.at(-1).notes.length,1);
  assert.ok(states.at(-1).documents.some(note=>note.id==='n0'),'Switching folders must not unmount the open draft');
  f.hub.setView('alice','all',true);
  assert.equal(f.connections[2].options.all,true);
  f.connections[2].next(f.snapshot(rows(0,70)));
  assert.equal(states.at(-1).notes.length,70);assert.equal(states.at(-1).hasMore,false);
  f.hub.setView('alice','all',true);assert.equal(f.connections.length,3,'Typing another search character must reuse the full inventory');
  f.hub.setView('alice','all',false);
  assert.equal(f.connections[3].options.all,false);assert.equal(f.connections[3].options.pageSize,20);
});

test('a note leaving a limited result remains live; only its document deletion erases the editor', ()=>{
  const f=fixture({withBodies:true}),received=[];
  f.hub.subscribePage('alice',()=>{});f.connections[0].next(f.snapshot(rows(0,20)));
  const stop=f.hub.subscribeBody('alice','n19',note=>received.push(note));
  assert.equal(f.bodies.length,0,'An on-page note should share the list snapshot');
  f.connections[0].next(f.snapshot(rows(50,20)));
  assert.equal(f.bodies.length,1);assert.equal(received.at(-1).deleted,false);
  f.bodies[0].next(f.snapshot([{...rows(19,1)[0],text:'다른 창 수정',revision:2}]).docs[0]);
  assert.equal(received.at(-1).text,'다른 창 수정');
  f.bodies[0].next(null);assert.equal(received.at(-1).deleted,true);
  stop();assert.equal(f.bodies[0].stopped,true);
});

test('inventory, preparation and every opened editor use one account-scoped remote listener', async()=>{
  const f=fixture(),lists=[],first=[],second=[];
  const stopList=f.hub.subscribeList('alice',notes=>lists.push(notes));
  const ready=f.hub.serverNotes('alice');
  const stopA=f.hub.subscribeBody('alice','a',note=>first.push(note));
  const stopB=f.hub.subscribeBody('alice','b',note=>second.push(note));
  assert.equal(f.connections.length,1);
  f.connections[0].next(f.snapshot([{id:'a',text:'원문',revision:2},{id:'b',text:'다른 메모',revision:4}]));
  assert.equal((await ready).length,2);
  assert.equal(lists[0][0].text,'원문');
  assert.deepEqual(first,[{text:'원문',revision:2,deleted:false}]);
  assert.deepEqual(second,[{text:'다른 메모',revision:4,deleted:false}]);
  const replay=[];
  const stopReplay=f.hub.subscribeBody('alice','a',note=>replay.push(note));
  assert.deepEqual(replay,first);
  assert.equal(f.connections.length,1,'Opening an existing note must not fetch its document again');
  stopList();stopA();stopB();assert.equal(f.connections[0].stopped,false);
  stopReplay();assert.equal(f.connections[0].stopped,true);
  f.hub.subscribeList('alice',()=>{});
  assert.equal(f.connections.length,2,'Reopening after all consumers leave must start a fresh stream');
});

test('pending writes do not overwrite drafts; metadata acknowledgement delivers the saved revision', async()=>{
  const f=fixture(),received=[];
  f.hub.subscribeBody('alice','a',note=>received.push(note));
  const ready=f.hub.serverNotes('alice');
  const records=[{id:'a',text:'저장 중',revision:3}];
  f.connections[0].next(f.snapshot(records,{pending:['a']}));
  assert.equal(received.length,0);
  let resolved=false;ready.then(()=>{resolved=true;});await Promise.resolve();
  assert.equal(resolved,false);
  f.connections[0].next(f.snapshot(records));
  await ready;
  assert.deepEqual(received,[{text:'저장 중',revision:3,deleted:false}]);
  f.connections[0].next(f.snapshot([{...records[0],title:'제목 수정'}]));
  assert.equal(received.length,1,'Metadata-only changes must not reset the body');
});

test('incomplete cached inventories never delete a missing note or authorize startup cleanup', async()=>{
  const f=fixture(),received=[];
  f.hub.subscribeBody('alice','a',note=>received.push(note));
  const ready=f.hub.serverNotes('alice');
  f.connections[0].next(f.snapshot([],{fromCache:true}));
  assert.equal(received.length,0);
  let resolved=false;ready.then(()=>{resolved=true;});await Promise.resolve();assert.equal(resolved,false);
  f.connections[0].next(f.snapshot([{id:'a',text:'유지',revision:1}]));
  assert.equal((await ready)[0].text,'유지');
  f.connections[0].next(f.snapshot([]));
  assert.equal(received.at(-1).deleted,true);
});

test('accounts never share data, failures reach every consumer, and retry reconnects once', ()=>{
  const f=fixture(),alice=[],bob=[],failures=[];
  const stopAlice=f.hub.subscribeList('alice',notes=>alice.push(notes),error=>failures.push(error));
  const stopBody=f.hub.subscribeBody('alice','a',()=>{},error=>failures.push(error));
  f.hub.subscribeList('bob',notes=>bob.push(notes));
  f.connections[0].next(f.snapshot([{id:'a',text:'alice 전용'}]));
  assert.equal(bob.length,0);
  f.connections[1].next(f.snapshot([{id:'a',text:'bob 전용'}]));
  assert.equal(bob[0][0].text,'bob 전용');assert.equal(alice[0][0].text,'alice 전용');
  const error=new Error('permission-denied');f.connections[0].error(error);
  assert.deepEqual(failures,[error,error]);
  f.hub.subscribeList('alice',notes=>alice.push(notes));
  assert.equal(f.connections.length,3);assert.equal(f.connections[0].stopped,true);
  f.connections[0].next(f.snapshot([{id:'a',text:'오래된 연결'}]));
  assert.equal(alice.length,1);
  f.connections[2].next(f.snapshot([{id:'a',text:'다시 연결'}]));
  assert.equal(alice.at(-1)[0].text,'다시 연결');
  stopAlice();stopBody();assert.equal(f.connections[1].stopped,false);
});

test('cancelling startup releases its listener and ignores late snapshots', async()=>{
  const f=fixture(),controller=new AbortController();
  const ready=f.hub.serverNotes('alice',{signal:controller.signal});
  controller.abort();
  await assert.rejects(ready,{name:'AbortError'});
  assert.equal(f.connections[0].stopped,true);
  f.connections[0].next(f.snapshot([]));
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(f.hub.serverNotes('alice',{signal:aborted.signal}),{name:'AbortError'});
  assert.equal(f.connections.length,1);
});

test('shared snapshots preserve local drafts, saved revisions, conflicts and remote deletions', async()=>{
  const f=fixture(),drafts=new Map();
  const stopList=f.hub.subscribeList('alice',()=>{});
  f.connections[0].next(f.snapshot([{id:'a',text:'원문',revision:1}]));
  const store=createNotepadStore({uid:'alice',noteId:'a',delay:60000,
    subscribe:(uid,next,error)=>f.hub.subscribeBody(uid,'a',next,error),
    storage:{getItem:key=>drafts.get(key) ?? null,setItem:(key,value)=>drafts.set(key,value),removeItem:key=>drafts.delete(key)},
    save:async(_uid,text,revision)=>{
      const records=[{id:'a',text,revision:revision+1}];
      f.connections[0].next(f.snapshot(records,{pending:['a']}));
      await Promise.resolve();f.connections[0].next(f.snapshot(records));
      return revision+1;
    },
  });
  const stopStore=store.start();
  try {
    assert.equal(store.getSnapshot().text,'원문');
    store.edit('내 수정');
    assert.equal(JSON.parse(drafts.get(noteDraftKey('alice','a'))).text,'내 수정');
    await store.flush();
    assert.equal(store.getSnapshot().dirty,false);assert.equal(store.getSnapshot().conflict,null);
    assert.equal(store.getSnapshot().text,'내 수정');assert.equal(drafts.has(noteDraftKey('alice','a')),false);
    store.edit('저장 전 내 수정');
    f.connections[0].next(f.snapshot([{id:'a',text:'다른 창의 수정',revision:3}]));
    assert.equal(store.getSnapshot().text,'저장 전 내 수정');
    assert.equal(store.getSnapshot().conflict.text,'다른 창의 수정');
    store.resolveConflict(false);
    assert.equal(store.getSnapshot().text,'다른 창의 수정');
    f.connections[0].next(f.snapshot([]));
    assert.equal(store.getSnapshot().deleted,true);assert.equal(drafts.size,0);
    assert.equal(f.connections.length,1);
  } finally {stopStore();stopList();}
});

test('the real query keeps the default view bounded and uses a safe folder-only fallback for a missing index', ()=>{
  const watches=[],states=[],errors=[],db={};
  const context=vm.createContext({db,createNoteSnapshotHub,
    collection:(_db,...parts)=>({path:parts.join('/')}),doc:(_db,...parts)=>({path:parts.join('/')}),
    query:(ref,...constraints)=>({...ref,constraints}),where:(field,op,value)=>({kind:'where',field,op,value}),
    orderBy:(field,direction)=>({kind:'order',field,direction}),limit:value=>({kind:'limit',value}),startAfter:cursor=>({kind:'cursor',cursor}),
    onSnapshot:(q,options,next,error)=>{const watch={q,options,next,error,stopped:false};watches.push(watch);return()=>{watch.stopped=true;};},
  });
  const source=fs.readFileSync('src/features/notes/noteSubscriptions.js','utf8')
    .replace(/import[\s\S]*?from\s*['"][^'"]+['"];?/g,'').replace(/export const /g,'const ');
  vm.runInContext(source+'\nglobalThis.api={subscribeNoteList,setNoteLibraryView,loadMoreNotes};',context);
  const stop=context.api.subscribeNoteList('alice',state=>states.push(state),error=>errors.push(error));
  assert.equal(watches[0].q.path,'notepads/alice/notes');
  assert.ok(watches[0].q.constraints.some(item=>item.kind==='limit'&&item.value===20));
  assert.ok(!watches[0].q.constraints.some(item=>item.kind==='where'),'The default query must not depend on an extra composite index');
  const f=fixture();watches[0].next(f.snapshot(rows(0,20)));
  context.api.setNoteLibraryView('alice','study',false);
  assert.equal(watches[0].stopped,true);
  watches[1].error({code:'failed-precondition'});
  assert.equal(watches[2].q.constraints.length,1);
  assert.equal(watches[2].q.constraints[0].field,'folderId');assert.equal(watches[2].q.constraints[0].value,'study');
  watches[2].next(f.snapshot(rows(0,45).reverse()));
  assert.equal(states.at(-1).notes.length,20);assert.equal(states.at(-1).notes[0].id,'n0');
  context.api.loadMoreNotes('alice');watches[3].error({code:'failed-precondition'});
  watches[4].next(f.snapshot(rows(0,45)));
  assert.equal(states.at(-1).notes.length,40);assert.equal(states.at(-1).notes[20].id,'n20');
  context.api.setNoteLibraryView('alice','all',false);
  assert.equal(watches[2].stopped,true);assert.equal(watches[4].stopped,true);
  watches[5].error({code:'permission-denied'});
  assert.equal(watches.length,6,'Permission errors must never broaden a query');
  assert.equal(errors.at(-1).code,'permission-denied');stop();
});
