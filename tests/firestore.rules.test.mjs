import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, collection, query, where, writeBatch } from 'firebase/firestore';

const collections = ['goals', 'subGoals', 'tasks', 'todos', 'plannerActivities', 'scheduleBlocks', 'controlActivities', 'controlBlocks', 'habits', 'habitLogs', 'progressItems', 'progressLogs'];
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
