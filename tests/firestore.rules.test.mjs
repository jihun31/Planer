import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, collection, query, where, writeBatch, onSnapshot, orderBy, limit, startAfter, Timestamp } from 'firebase/firestore';
import { createNoteSnapshotHub } from '../src/features/notes/noteSnapshotHub.mjs';

const collections = ['goals', 'subGoals', 'tasks', 'todos', 'plannerActivities', 'scheduleBlocks', 'controlActivities', 'controlBlocks', 'habits', 'habitLogs', 'progressItems', 'progressLogs'];

test('day plans isolate owners, preserve routine history and validate atomic revisions', async()=>{
  const {serverTimestamp}=await import('firebase/firestore');
  const uid='day-plan-alice',alice=env.authenticatedContext(uid).firestore(),bob=env.authenticatedContext('day-plan-bob').firestore(),guest=env.unauthenticatedContext().firestore();
  const root=doc(alice,'dayPlans',uid),routine=revision=>({uid,routineId:'english',revision,title:'영어',startMinute:540,endMinute:600,weekdays:[1,3],effectiveDate:'2026-10-26',deleted:false,createdAt:serverTimestamp()});
  const append=(revision,changes={})=>{const batch=writeBatch(alice);batch.set(root,{uid,revision,updatedAt:serverTimestamp()});batch.set(doc(alice,'dayPlans',uid,'routines',`v${revision}`),{...routine(revision),...changes});return batch;};
  await assertSucceeds(append(1).commit());
  await assertSucceeds(append(2,{title:'영어 수정'}).commit());
  assert.equal((await getDocs(collection(alice,'dayPlans',uid,'routines'))).size,2);
  for(const db of [bob,guest]){
    await assertFails(getDoc(doc(db,'dayPlans',uid)));
    await assertFails(getDocs(collection(db,'dayPlans',uid,'routines')));
    await assertFails(getDocs(collection(db,'dayPlans',uid,'entries')));
    await assertFails(setDoc(doc(db,'dayPlans',uid,'entries','attack'),{uid}));
  }
  await assertFails(updateDoc(doc(alice,'dayPlans',uid,'routines','v1'),{title:'과거 변경'}));
  await assertFails(deleteDoc(doc(alice,'dayPlans',uid,'routines','v1')));
  await assertFails(setDoc(doc(alice,'dayPlans',uid,'routines','unpaired'),routine(3)));
  for(const changes of [{weekdays:[]},{weekdays:[1,1]},{weekdays:[7]},{endMinute:540},{startMinute:-1},{endMinute:2000},{title:''},{extra:true},{uid:'other'}])await assertFails(append(3,changes).commit());
  assert.equal((await getDoc(root)).data().revision,2);
  const entry={uid,title:'오늘 영어',date:'2026-10-26',routineId:null,startMinute:540,endMinute:600,skipped:false,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  const single=doc(alice,'dayPlans',uid,'entries','single');
  await assertSucceeds(setDoc(single,entry));
  await assertSucceeds(setDoc(doc(alice,'dayPlans',uid,'entries','next-day'),{...entry,startMinute:1560,endMinute:1590,activityId:'english',activityColor:'#22c55e'}));
  for(const invalid of [{activityId:'../other'},{activityColor:'red'},{startMinute:2880,endMinute:2881},{startMinute:2870,endMinute:2890}])
    await assertFails(setDoc(doc(alice,'dayPlans',uid,'entries','bad-linked'),{...entry,...invalid}));
  await assertSucceeds(append(3,{activityId:'english',activityColor:'#22c55e',startMinute:1560,endMinute:1590}).commit());
  // Use the next revision after the linked routine above.
  const failed=append(4,{weekdays:[]});failed.delete(single);await assertFails(failed.commit());assert.equal((await getDoc(single)).exists(),true);
  await assertFails(updateDoc(single,{date:'2026-10-27',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(single,{skipped:true,updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(single,{title:'당일만 변경',updatedAt:serverTimestamp()}));
  const override=doc(alice,'dayPlans',uid,'entries','2026-10-26_english');
  await assertFails(setDoc(doc(alice,'dayPlans',uid,'entries','wrong-id'),{...entry,routineId:'english'}));
  await assertSucceeds(setDoc(override,{...entry,routineId:'english',skipped:true}));
  await assertSucceeds(getDocs(query(collection(alice,'dayPlans',uid,'entries'),where('date','in',['2026-10-25','2026-10-26','2026-10-27']))));
  await assertFails(deleteDoc(doc(bob,'dayPlans',uid,'entries','2026-10-26_english')));
  await assertSucceeds(deleteDoc(override));
  const converted=append(4);converted.delete(single);await assertSucceeds(converted.commit());
  assert.equal((await getDoc(single)).exists(),false);
  await assertFails(append(5,{removed:'true',deleted:true}).commit());
  await assertFails(append(5,{removed:true,deleted:false}).commit());
  await assertSucceeds(append(5,{removed:true,deleted:true}).commit());
  assert.equal((await getDoc(doc(alice,'dayPlans',uid,'routines','v1'))).exists(),true);
});

test('paginated notes use real Firestore cursors, complete title search and out-of-page live editors', {timeout:20000}, async()=>{
  const uid='paged-notes-alice';
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),batch=writeBatch(db);
    for(let index=0;index<45;index++) batch.set(doc(db,'notepads',uid,'notes',`n${index}`),{
      uid,title:`메모 ${index}`,text:`본문 ${index}`,revision:0,archived:false,folderId:index < 10 ? 'study' : 'older',
      createdAt:Timestamp.fromMillis(100000-index),updatedAt:Timestamp.fromMillis(100000-index),
    });
    await batch.commit();
  });
  const db=env.authenticatedContext(uid).firestore(),states=[],bodies=[],waiting=[];
  const changed=()=>{for(const waiter of [...waiting]) if(waiter.predicate()) {waiting.splice(waiting.indexOf(waiter),1);waiter.resolve();}};
  const until=predicate=>predicate() ? Promise.resolve() : new Promise(resolve=>waiting.push({predicate,resolve}));
  const hub=createNoteSnapshotHub((owner,next,error,{folder,all,cursor,pageSize})=>{
    const filters=[orderBy('updatedAt','desc')];
    if(folder !== 'all')filters.push(where('folderId','==',folder));
    if(!all)filters.push(limit(pageSize));if(cursor)filters.push(startAfter(cursor));
    return onSnapshot(query(collection(db,'notepads',owner,'notes'),...filters),{includeMetadataChanges:true},next,error);
  },{listenBody:(owner,id,next,error)=>onSnapshot(doc(db,'notepads',owner,'notes',id),{includeMetadataChanges:true},snapshot=>
    next(snapshot.exists()?snapshot:null),error)});
  const errors=[];
  const stop=hub.subscribePage(uid,state=>{states.push(state);changed();},error=>errors.push(error));
  let stopBody;
  try {
    await until(()=>states.at(-1)?.serverReady);
    assert.equal(states.at(-1).notes.length,20);assert.equal(states.at(-1).notes[19].id,'n19');
    hub.loadMore(uid);await until(()=>states.at(-1)?.serverReady && states.at(-1).notes.length===40);
    hub.loadMore(uid);await until(()=>states.at(-1)?.notes.length===45);
    assert.equal(states.at(-1).hasMore,false);
    stopBody=hub.subscribeBody(uid,'n44',value=>{bodies.push(value);changed();});
    hub.setView(uid,'study',false);await until(()=>states.at(-1)?.folder==='study' && states.at(-1).serverReady);
    assert.equal(states.at(-1).notes.length,10);
    await env.withSecurityRulesDisabled(context=>updateDoc(doc(context.firestore(),'notepads',uid,'notes','n44'),{text:'다른 창 수정',revision:1}));
    await until(()=>bodies.at(-1)?.text==='다른 창 수정');
    assert.equal(bodies.at(-1).deleted,false);
    hub.setView(uid,'all',true);await until(()=>states.at(-1)?.all && states.at(-1).serverReady);
    assert.equal(states.at(-1).notes.length,45);assert.ok(states.at(-1).notes.some(note=>note.title==='메모 44'));
    assert.deepEqual(errors,[]);
  } finally {stopBody?.();stop();}
});

test('calendar events are private, validated and support atomic optional task registration', async () => {
  const alice = env.authenticatedContext('calendar-alice').firestore();
  const bob = env.authenticatedContext('calendar-bob').firestore();
  const guest = env.unauthenticatedContext().firestore();
  const { serverTimestamp } = await import('firebase/firestore');
  const data = { uid: 'calendar-alice', title: '병원 방문', date: '2026-10-22', note: '', color: '#6366f1', taskId: null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  const ref = doc(alice, 'calendarEvents', 'private-event');
  await assertSucceeds(setDoc(ref, data));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(getDocs(query(collection(alice, 'calendarEvents'), where('uid', '==', 'calendar-alice'), where('date', 'in', ['2026-10-22']))));
  await assertFails(getDocs(collection(alice, 'calendarEvents')));
  await assertFails(getDocs(query(collection(bob, 'calendarEvents'), where('uid', '==', 'calendar-alice'))));
  await assertFails(getDoc(doc(bob, 'calendarEvents', 'private-event')));
  await assertFails(getDoc(doc(guest, 'calendarEvents', 'private-event')));
  await assertFails(setDoc(doc(bob, 'calendarEvents', 'forged'), data));
  await assertFails(setDoc(doc(guest, 'calendarEvents', 'guest'), data));
  await assertFails(updateDoc(doc(bob, 'calendarEvents', 'private-event'), { title: '침입' }));
  await assertFails(deleteDoc(doc(bob, 'calendarEvents', 'private-event')));
  for (const invalid of [{ title: '' }, { title: 'x'.repeat(121) }, { note: 'x'.repeat(5001) }, { date: 'invalid' }, { color: 'red' }, { taskId: '' }, { extra: true }]) {
    await assertFails(setDoc(doc(alice, 'calendarEvents', 'invalid-event'), { ...data, ...invalid }));
  }
  await assertFails(updateDoc(ref, { uid: 'calendar-bob', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { taskId: 'other', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { title: '수정', date: '2026-11-01', updatedAt: serverTimestamp() }));

  const batch = writeBatch(alice);
  batch.set(doc(alice, 'calendarEvents', 'with-task'), { ...data, taskId: 'calendar-task' });
  batch.set(doc(alice, 'todos', 'calendar-task'), { uid: 'calendar-alice', title: data.title, dueDate: data.date,
    completed: false, calendarEventId: 'with-task', createdAt: serverTimestamp() });
  await assertSucceeds(batch.commit());
  assert.equal((await getDoc(doc(alice, 'todos', 'calendar-task'))).data().dueDate, data.date);
  await assertSucceeds(deleteDoc(doc(alice, 'calendarEvents', 'with-task')));
  assert.equal((await getDoc(doc(alice, 'todos', 'calendar-task'))).exists(), true);

  const forbidden = writeBatch(alice);
  forbidden.set(doc(alice, 'calendarEvents', 'atomic-failure'), { ...data, taskId: 'forbidden-task' });
  forbidden.set(doc(alice, 'todos', 'forbidden-task'), { uid: 'calendar-bob', title: 'forged' });
  await assertFails(forbidden.commit());
  await env.withSecurityRulesDisabled(async context => {
    assert.equal((await getDoc(doc(context.firestore(), 'calendarEvents', 'atomic-failure'))).exists(), false);
  });
  await assertSucceeds(deleteDoc(ref));
});

test('notepads are private, revision-checked, bounded and readable before first save', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  const guest = env.unauthenticatedContext().firestore();
  const { serverTimestamp } = await import('firebase/firestore');
  const ref = doc(alice,'notepads','alice');
  const data = {uid:'alice',text:'메모\n두 번째 줄',revision:1,updatedAt:serverTimestamp()};
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(setDoc(ref,data));
  await assertSucceeds(setDoc(ref,{...data,text:'수정한 메모',revision:2}));
  await assertFails(setDoc(ref,{...data,text:'오래된 수정',revision:2}));
  await assertSucceeds(setDoc(ref,{...data,text:'',revision:3}));
  await assertFails(setDoc(ref,{...data,text:'x'.repeat(50001),revision:4}));
  await assertFails(setDoc(ref,{...data,revision:4,extra:'forbidden'}));
  await assertFails(setDoc(ref,{...data,revision:4,uid:'bob'}));
  await assertFails(setDoc(ref,{...data,revision:4,updatedAt:0}));
  await assertFails(getDoc(doc(bob,'notepads','alice')));
  await assertFails(setDoc(doc(bob,'notepads','alice'),{...data,uid:'bob',revision:4}));
  await assertFails(getDoc(doc(guest,'notepads','alice')));
  await assertFails(deleteDoc(ref));
});
test('learning goals are private, bounded and append-only', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  const { serverTimestamp } = await import('firebase/firestore');
  const data = {uid:'alice',minutes:60,effectiveDate:'2026-10-18',changedAt:1,createdAt:serverTimestamp()};
  const ref = doc(alice,'learningGoals','first');
  await assertSucceeds(setDoc(ref,data));
  await assertSucceeds(setDoc(doc(alice,'learningGoals','activities'),{
    ...data, includedActivityIds:['math','english'], activityTargets:{math:45},
  }));
  const savedSelection = await assertSucceeds(getDoc(doc(alice,'learningGoals','activities')));
  assert.deepEqual(savedSelection.data().includedActivityIds,['math','english']);
  assert.deepEqual(savedSelection.data().activityTargets,{math:45});
  await assertFails(setDoc(doc(alice,'learningGoals','partial'),{
    ...data, includedActivityIds:['math'],
  }));
  await assertFails(setDoc(doc(alice,'learningGoals','unselected-target'),{
    ...data, includedActivityIds:['math'], activityTargets:{english:30},
  }));
  await assertSucceeds(getDocs(query(collection(alice,'learningGoals'),where('uid','==','alice'))));
  await assertFails(getDoc(doc(bob,'learningGoals','first')));
  await assertFails(setDoc(doc(bob,'learningGoals','forged'),data));
  await assertFails(updateDoc(ref,{minutes:30}));
  await assertFails(deleteDoc(ref));
  for (const minutes of [0,4,1441,5.5,'60']) {
    await assertFails(setDoc(doc(alice,'learningGoals','invalid'),{...data,minutes}));
  }
  await assertFails(setDoc(doc(alice,'learningGoals','invalid-date'),{...data,effectiveDate:'invalid'}));
});

test('multiple notes support metadata moves and permanent deletion but require revisions for body changes', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  const guest = env.unauthenticatedContext().firestore();
  const { serverTimestamp } = await import('firebase/firestore');
  const ref = doc(alice,'notepads','alice','notes','multiple');
  const data = {uid:'alice',title:'첫 메모',text:'본문',revision:0,folderId:null,archived:false,
    createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  await assertSucceeds(setDoc(ref,data));
  await assertSucceeds(updateDoc(ref,{title:'새 제목',folderId:'study',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{text:'덮어쓰기',updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref,{text:'정상 수정',revision:1,updatedAt:serverTimestamp()}));
  assert.equal((await getDoc(ref)).data().title,'새 제목');
  await assertSucceeds(updateDoc(ref,{archived:true,updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref,{archived:false,updatedAt:serverTimestamp()}));
  await assertSucceeds(getDocs(collection(alice,'notepads','alice','notes')));
  await assertFails(getDocs(collection(bob,'notepads','alice','notes')));
  await assertFails(getDoc(doc(guest,'notepads','alice','notes','multiple')));
  await assertFails(updateDoc(doc(bob,'notepads','alice','notes','multiple'),{title:'침입',updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(alice,'notepads','alice','notes','forged'),{...data,uid:'bob'}));
  await assertFails(updateDoc(ref,{text:'x'.repeat(50001),revision:2,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{title:'',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(doc(bob,'notepads','alice','notes','multiple')));
  await assertSucceeds(deleteDoc(ref));
});

test('legacy deletion erases the original body and blocks stale client recreation while new notes remain available', async () => {
  const alice = env.authenticatedContext('legacy-delete-owner').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  const {serverTimestamp} = await import('firebase/firestore');
  const parent = doc(alice,'notepads','legacy-delete-owner');
  const legacy = doc(alice,'notepads','legacy-delete-owner','notes','legacy');
  const note = {uid:'legacy-delete-owner',title:'기존 메모',text:'',revision:0,folderId:null,archived:false,
    createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  await assertSucceeds(setDoc(parent,{uid:'legacy-delete-owner',text:'이전 원문',revision:1,updatedAt:serverTimestamp()}));
  await assertSucceeds(setDoc(legacy,note));
  const deletion = writeBatch(alice);
  deletion.set(parent,{uid:'legacy-delete-owner',text:'',revision:2,deleted:true,updatedAt:serverTimestamp()});
  deletion.delete(legacy);
  await assertSucceeds(deletion.commit());
  assert.equal((await getDoc(parent)).data().text,'');
  assert.equal((await getDoc(legacy)).exists(),false);
  await assertFails(setDoc(parent,{uid:'legacy-delete-owner',text:'복원 시도',revision:3,updatedAt:serverTimestamp()}));
  await assertFails(setDoc(legacy,note));
  await assertFails(deleteDoc(doc(bob,'notepads','legacy-delete-owner','notes','legacy')));
  await assertSucceeds(setDoc(doc(alice,'notepads','legacy-delete-owner','notes','fresh'),note));
});

test('note folders are owner-scoped and allow rename and deletion without broadening access', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  const { serverTimestamp } = await import('firebase/firestore');
  const ref = doc(alice,'notepads','alice','folders','study');
  const data = {uid:'alice',name:'공부',createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  await assertSucceeds(setDoc(ref,data));
  await assertSucceeds(updateDoc(ref,{name:'학습',updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref,{sortOrder:0,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{sortOrder:-1,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{sortOrder:1.5,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{sortOrder:'1',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(bob,'notepads','alice','folders','study'),{sortOrder:1,updatedAt:serverTimestamp()}));
  await assertSucceeds(getDocs(collection(alice,'notepads','alice','folders')));
  await assertFails(getDoc(doc(bob,'notepads','alice','folders','study')));
  await assertFails(setDoc(doc(bob,'notepads','alice','folders','forged'),{...data,uid:'bob'}));
  await assertFails(updateDoc(ref,{name:'x'.repeat(81),updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{extra:true,updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(doc(bob,'notepads','alice','folders','study')));
  await assertSucceeds(deleteDoc(ref));
});
let env;
before(async () => {
  // Explicit demo project and local emulator: never touches the live project.
  env = await initializeTestEnvironment({
    projectId: 'demo-planer-security',
    firestore: { host: '127.0.0.1', port: 8088, rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });
for (const name of collections) {
  test(name + ': owners can CRUD; other users and anonymous clients are rejected', async () => {
    const alice = env.authenticatedContext('alice').firestore();
    const bob = env.authenticatedContext('bob').firestore();
    const guest = env.unauthenticatedContext().firestore();
    await assertSucceeds(setDoc(doc(alice, name, 'alice-item'), { uid: 'alice', title: 'private' }));
    await assertSucceeds(getDoc(doc(alice, name, 'alice-item')));
    await assertSucceeds(updateDoc(doc(alice, name, 'alice-item'), { title: 'changed' }));
    await assertFails(getDoc(doc(bob, name, 'alice-item')));
    await assertFails(updateDoc(doc(bob, name, 'alice-item'), { title: 'attack' }));
    await assertFails(deleteDoc(doc(bob, name, 'alice-item')));
    await assertFails(getDoc(doc(guest, name, 'alice-item')));
    await assertFails(setDoc(doc(guest, name, 'guest'), { uid: 'alice' }));
    await assertFails(setDoc(doc(bob, name, 'forged'), { uid: 'alice' }));
    await assertFails(setDoc(doc(alice, name, 'missing-uid'), { title: 'missing' }));
    await assertFails(updateDoc(doc(alice, name, 'alice-item'), { uid: 'bob' }));
    await assertSucceeds(getDocs(query(collection(alice, name), where('uid', '==', 'alice'))));
    await assertFails(getDocs(collection(alice, name)));
    await assertFails(getDocs(query(collection(bob, name), where('uid', '==', 'alice'))));
    await assertSucceeds(deleteDoc(doc(alice, name, 'alice-item')));
  });
}
test('date-limited IN queries remain owner-scoped and include legacy minute/slot records', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  for (const db of [alice, bob]) {
    const uid = db === alice ? 'alice' : 'bob';
    await setDoc(doc(db, 'scheduleBlocks', uid + '-sep'), { uid, date: '2026-09-30', startSlot: 1, endSlot: 2 });
    await setDoc(doc(db, 'scheduleBlocks', uid + '-oct'), { uid, date: '2026-10-31', startMin: 1, endMin: 11 });
  }
  const result = await assertSucceeds(getDocs(query(collection(alice, 'scheduleBlocks'),
    where('uid', '==', 'alice'), where('date', 'in', ['2026-10-31']))));
  assert.deepEqual(result.docs.map(d => d.id), ['alice-oct']);
  await assertFails(getDocs(query(collection(alice, 'scheduleBlocks'), where('date', 'in', ['2026-10-31']))));
});
test('cascade deletion cannot delete another users linked record', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  await setDoc(doc(alice, 'goals', 'parent'), { uid: 'alice' });
  await setDoc(doc(alice, 'subGoals', 'child-a'), { uid: 'alice', goalId: 'parent' });
  await setDoc(doc(bob, 'subGoals', 'child-b'), { uid: 'bob', goalId: 'parent' });
  await assertFails(getDocs(query(collection(alice, 'subGoals'), where('goalId', '==', 'parent'))));
  const own = await assertSucceeds(getDocs(query(collection(alice, 'subGoals'),
    where('uid', '==', 'alice'), where('goalId', '==', 'parent'))));
  assert.equal(own.size, 1);
  const batch = writeBatch(alice);
  own.docs.forEach(d => batch.delete(d.ref));
  batch.delete(doc(alice, 'goals', 'parent'));
  await assertSucceeds(batch.commit());
  assert.ok((await getDoc(doc(bob, 'subGoals', 'child-b'))).exists());
});
test('unknown collections, nested paths and records without uid fail closed', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  await assertFails(setDoc(doc(alice, 'unknown', 'x'), { uid: 'alice' }));
  await assertFails(setDoc(doc(alice, 'goals', 'x', 'nested', 'y'), { uid: 'alice' }));
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'goals', 'legacy-without-uid'), { title: 'legacy' });
  });
  await assertFails(getDoc(doc(alice, 'goals', 'legacy-without-uid')));
});

test('priority notes are private to their owner and keep a numbered list', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  const guest = env.unauthenticatedContext().firestore();
  const ref = doc(alice, 'priorityNotes', 'alice');
  const notes = [{ id: 'a', text: 'First' }, { id: 'b', text: 'Second' }];
  await assertSucceeds(setDoc(ref, { uid: 'alice', items: notes }));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(updateDoc(ref, { items: [...notes].reverse() }));
  await assertFails(getDoc(doc(bob, 'priorityNotes', 'alice')));
  await assertFails(getDoc(doc(guest, 'priorityNotes', 'alice')));
  await assertFails(setDoc(doc(bob, 'priorityNotes', 'alice'), { uid: 'bob', items: [] }));
  await assertFails(setDoc(doc(alice, 'priorityNotes', 'bob'), { uid: 'alice', items: [] }));
  await assertFails(updateDoc(ref, { uid: 'bob' }));
  await assertFails(updateDoc(ref, { items: 'not-a-list' }));
  await assertFails(deleteDoc(ref));
});

test('schedule settings are owner-scoped, validated and append-only', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  const guest = env.unauthenticatedContext().firestore();
  const { serverTimestamp } = await import('firebase/firestore');
  const data = {uid:'alice',startHour:10,endHour:1,effectiveDate:'2026-10-05',changedAt:1,createdAt:serverTimestamp()};
  const ref=doc(alice,'plannerSettings','range');
  await assertSucceeds(setDoc(ref,data));
  await assertSucceeds(getDocs(query(collection(alice,'plannerSettings'),where('uid','==','alice'))));
  await assertFails(getDoc(doc(bob,'plannerSettings','range')));
  await assertFails(getDoc(doc(guest,'plannerSettings','range')));
  await assertFails(setDoc(doc(bob,'plannerSettings','forged'),data));
  await assertFails(setDoc(doc(alice,'plannerSettings','invalid'),{...data,startHour:24}));
  await assertSucceeds(setDoc(doc(alice,'plannerSettings','display'),{...data,plannerOppositeDisplay:'faded',controlOppositeDisplay:'hidden'}));
  await assertSucceeds(setDoc(doc(alice,'plannerSettings','legacy-display'),{...data,plannerOppositeDisplay:'transparent',controlOppositeDisplay:'blind'}));
  await assertFails(setDoc(doc(alice,'plannerSettings','invalid-display'),{...data,plannerOppositeDisplay:'unknown'}));
  await assertFails(updateDoc(ref,{startHour:7}));
  await assertFails(deleteDoc(ref));
});
