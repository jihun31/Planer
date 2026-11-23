// 최상위 컬렉션(목표·할 일·활동·학습 기록·습관)의 형식 검사. 앱이 실제로 쓰는 모양은 통과하고, 깨진 문서는 막는지 본다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, writeBatch, deleteField, FieldPath, serverTimestamp, Timestamp } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-planer-security',
    firestore: { host: '127.0.0.1', port: 8088, rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });

const uid = 'data-alice';
const db = () => env.authenticatedContext(uid).firestore();
const seed = (path, data) => env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), ...path), data));

test('goals, sub-goals, tasks and todos accept app writes and reject malformed fields', async () => {
  const alice = db();
  const goal = { uid, title: '토익 900', color: '#6366f1', createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(alice, 'goals', 'g1'), goal));
  for (const bad of [{ title: '' }, { title: 'x'.repeat(201) }, { color: 'blue' }, { extra: 1 }, { createdAt: Timestamp.fromMillis(1) }])
    await assertFails(setDoc(doc(alice, 'goals', 'bad'), { ...goal, ...bad }));
  await assertSucceeds(updateDoc(doc(alice, 'goals', 'g1'), { title: '토익 950' }));
  await assertSucceeds(updateDoc(doc(alice, 'goals', 'g1'), { color: '#ef4444' }));
  await assertFails(updateDoc(doc(alice, 'goals', 'g1'), { color: 'red' }));
  await assertFails(updateDoc(doc(alice, 'goals', 'g1'), { createdAt: serverTimestamp() }));

  const sub = { title: '단어 외우기', type: 'week', year: 2026, month: 11, weekOfMonth: 3, uid, goalId: 'g1', completed: false, createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(alice, 'subGoals', 's1'), sub));
  await assertSucceeds(setDoc(doc(alice, 'subGoals', 's2'), { ...sub, type: 'month', weekOfMonth: null }));
  await seed(['goals', 'bob-goal'], { uid: 'data-bob', title: 'bob', color: '#6366f1' });
  for (const bad of [{ goalId: 'bob-goal' }, { goalId: 'missing' }, { weekOfMonth: null }, { type: 'day' }, { month: 13 }, { year: '2026' }, { completed: true }])
    await assertFails(setDoc(doc(alice, 'subGoals', 'bad'), { ...sub, ...bad }));
  await assertSucceeds(updateDoc(doc(alice, 'subGoals', 's1'), { completed: true }));
  await assertFails(updateDoc(doc(alice, 'subGoals', 's1'), { completed: 'yes' }));
  await assertFails(updateDoc(doc(alice, 'subGoals', 's1'), { goalId: 'bob-goal' }));

  const task = { title: '보고서', dueDate: '2026-11-20', timeSlot: '오전', uid, completed: false, createdAt: serverTimestamp(), createdAtMs: Date.now() };
  await assertSucceeds(setDoc(doc(alice, 'tasks', 't1'), task));
  await assertSucceeds(setDoc(doc(alice, 'tasks', 't2'), { title: '팝업 할 일', dueDate: null, uid, completed: false, createdAt: serverTimestamp(), createdAtMs: 1 }));
  for (const bad of [{ timeSlot: '새벽' }, { dueDate: '11/20' }, { title: '' }, { createdAtMs: 'now' }])
    await assertFails(setDoc(doc(alice, 'tasks', 'bad'), { ...task, ...bad }));
  await assertSucceeds(updateDoc(doc(alice, 'tasks', 't1'), { completed: true }));
  await assertFails(updateDoc(doc(alice, 'tasks', 't1'), { title: '몰래 바꿈' }));

  const todo = { title: '장보기', dueDate: null, uid, completed: false, createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(alice, 'todos', 'd1'), todo));
  await assertFails(setDoc(doc(alice, 'todos', 'bad'), { ...todo, timeSlot: '오전' }));
  await assertSucceeds(updateDoc(doc(alice, 'todos', 'd1'), { title: '장보기 2', dueDate: '2026-11-21' }));
  await assertFails(updateDoc(doc(alice, 'todos', 'd1'), { dueDate: 'tomorrow' }));
  await assertFails(updateDoc(doc(alice, 'todos', 'd1'), { completed: true }));
});

test('activities keep their color rules and archive flow', async () => {
  const alice = db();
  const study = { name: '영어', color: '#22c55e', uid, createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(alice, 'plannerActivities', 'a1'), study));
  await assertFails(setDoc(doc(alice, 'plannerActivities', 'bad'), { ...study, color: 'green' }));
  await assertFails(setDoc(doc(alice, 'plannerActivities', 'bad'), { ...study, name: '' }));
  const batch = writeBatch(alice);
  batch.update(doc(alice, 'plannerActivities', 'a1'), { order: 0 });
  await assertSucceeds(batch.commit());
  await assertSucceeds(updateDoc(doc(alice, 'plannerActivities', 'a1'), { color: '#3b82f6' }));
  await assertSucceeds(updateDoc(doc(alice, 'plannerActivities', 'a1'), { archived: true, archivedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(alice, 'plannerActivities', 'a1'), { order: -1 }));
  await assertFails(updateDoc(doc(alice, 'plannerActivities', 'a1'), { name: '이름 변경' }));

  const control = { name: '휴대폰', group: 'foolish', color: '#dc2626', uid, createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(alice, 'controlActivities', 'c1'), control));
  await assertFails(setDoc(doc(alice, 'controlActivities', 'bad'), { ...control, color: '#2563eb' }));
  await assertFails(setDoc(doc(alice, 'controlActivities', 'bad'), { ...control, group: 'other' }));
  await assertSucceeds(updateDoc(doc(alice, 'controlActivities', 'c1'), { group: 'controlled', color: '#2563eb' }));
  await assertFails(updateDoc(doc(alice, 'controlActivities', 'c1'), { group: 'foolish' }));
  await assertSucceeds(updateDoc(doc(alice, 'controlActivities', 'c1'), { archived: true, archivedAt: serverTimestamp() }));
});

test('saved habit order is accessible only by its owner and rejects malformed order documents', async () => {
  const alice = doc(db(), 'habitOrders', uid);
  const bob = doc(env.authenticatedContext('data-bob').firestore(), 'habitOrders', uid);
  const guest = doc(env.unauthenticatedContext().firestore(), 'habitOrders', uid);
  await assertSucceeds(getDoc(alice));
  await assertSucceeds(setDoc(alice, { ids: ['habit-a', 'habit-b'] }));
  await assertSucceeds(setDoc(alice, { ids: ['habit-b', 'habit-a'] }));
  assert.deepEqual((await assertSucceeds(getDoc(alice))).data().ids, ['habit-b', 'habit-a']);
  for (const data of [{}, { ids: 'habit-a' }, { ids: ['habit-a', 'habit-a'] }, { ids: ['habit/a'] },
    { ids: [''] }, { ids: [123] }, { ids: [], extra: true }]) {
    await assertFails(setDoc(alice, data));
  }
  for (const ref of [bob, guest]) {
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { ids: ['habit-b'] }));
  }
});

test('schedule blocks accept every app record shape and reject broken time ranges', async () => {
  const alice = db();
  const base = { date: '2026-11-20', startMin: 60, endMin: 120, uid, createdAt: serverTimestamp() };
  const valid = {
    linked: { ...base, activityId: 'a1', activityName: '영어', activityColor: '#22c55e', kind: 'study' },
    linkedWithoutSnapshot: { ...base, activityId: 'a1', kind: 'study' },
    custom: { ...base, activityId: null, customName: '독서', customColor: '#f59e0b', learningIncluded: true, kind: 'study' },
    early: { ...base, startMin: -180, endMin: -120, activityId: 'a1', kind: 'study' },
    lateNight: { ...base, startMin: 1200, endMin: 1260, activityId: 'a1', activityName: '', activityColor: '#22c55e', kind: 'study' },
    control: { ...base, activityId: 'c1', activityName: '휴대폰', activityColor: '#dc2626', group: 'foolish', kind: 'control' },
    controlCustom: { ...base, activityId: null, customName: '멍때리기', customColor: '#2563eb', group: 'controlled', kind: 'control' },
    studyGap: { ...base, activityId: null, customName: '쉬기', group: 'controlled', kind: 'control', activityColor: '#2563eb', customColor: '#2563eb', source: 'study-gap' },
  };
  for (const [id, data] of Object.entries(valid)) await assertSucceeds(setDoc(doc(alice, 'scheduleBlocks', id), data));

  const linked = valid.linked;
  const invalid = [
    { endMin: 60 }, { endMin: 30 }, { startMin: '60' }, { startMin: 60.5 }, { startMin: -600 }, { endMin: 2500 },
    { startMin: 0, endMin: 1500 }, { date: '2026-11-2' }, { date: null }, { kind: 'rest' }, { activityId: '../x' },
    { activityId: null }, { customName: '둘 다' }, { activityColor: 'green' }, { learningIncluded: 'yes' },
    { group: 'controlled' }, { source: 'study-gap' }, { extra: true }, { createdAt: Timestamp.fromMillis(1) },
  ];
  for (const bad of invalid) await assertFails(setDoc(doc(alice, 'scheduleBlocks', 'bad'), { ...linked, ...bad }));
  await assertFails(setDoc(doc(alice, 'scheduleBlocks', 'bad'), { ...valid.control, learningIncluded: true }));
  const missingDate = { ...linked };
  delete missingDate.date;
  await assertFails(setDoc(doc(alice, 'scheduleBlocks', 'bad'), missingDate));

  // 타이머는 같은 ID로 다시 저장할 수 있다(재시도).
  const timerId = `${uid}_timer_1_0`;
  await assertSucceeds(setDoc(doc(alice, 'scheduleBlocks', timerId), linked));
  await assertSucceeds(setDoc(doc(alice, 'scheduleBlocks', timerId), { ...linked, createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(alice, 'scheduleBlocks', timerId), { ...linked, endMin: 600 }));

  // 활동 색 바꾸기·보관 활동 이름 남기기·직접 입력 학습 포함 여부만 고칠 수 있다.
  await assertSucceeds(updateDoc(doc(alice, 'scheduleBlocks', 'linked'), { activityColor: '#3b82f6' }));
  await assertSucceeds(updateDoc(doc(alice, 'scheduleBlocks', 'linkedWithoutSnapshot'), { activityName: '영어', activityColor: '#22c55e' }));
  await assertSucceeds(updateDoc(doc(alice, 'scheduleBlocks', 'custom'), { learningIncluded: false }));
  for (const bad of [{ activityColor: 'blue' }, { learningIncluded: 1 }, { endMin: 9999 }, { date: '2026-11-21' }, { uid: 'data-bob' }, { kind: 'control' }])
    await assertFails(updateDoc(doc(alice, 'scheduleBlocks', 'linked'), bad));

  // 예전 형식 기록도 색은 계속 바꿀 수 있다.
  await seed(['scheduleBlocks', 'legacy-slot'], { uid, date: '2026-01-01', startSlot: 1, endSlot: 2, activityId: 'a1' });
  await assertSucceeds(updateDoc(doc(alice, 'scheduleBlocks', 'legacy-slot'), { activityColor: '#3b82f6' }));
});

test('legacy control blocks can only be moved into schedule blocks, not created or edited', async () => {
  const alice = db();
  const old = { uid, date: '2026-01-01', startSlot: 4, endSlot: 6, activityName: '예전 통제', note: 'unknown legacy field' };
  await seed(['controlBlocks', 'old1'], old);
  await assertFails(setDoc(doc(alice, 'controlBlocks', 'new'), old));
  await assertFails(updateDoc(doc(alice, 'controlBlocks', 'old1'), { note: 'edit' }));
  const batch = writeBatch(alice);
  batch.set(doc(alice, 'scheduleBlocks', `legacy-control-${uid}-old1`), { ...old, kind: 'control' });
  batch.delete(doc(alice, 'controlBlocks', 'old1'));
  await assertSucceeds(batch.commit());
  await assertFails(setDoc(doc(alice, 'scheduleBlocks', 'not-legacy-old2'), { ...old, kind: 'control' }));
  await assertFails(setDoc(doc(alice, 'scheduleBlocks', `legacy-control-${uid}-old3`), { ...old, kind: 'study' }));
  await assertFails(setDoc(doc(alice, 'scheduleBlocks', 'legacy-control-data-bob-old4'), { ...old, kind: 'control' }));
  await assertFails(setDoc(doc(alice, 'habitLogs', 'new'), { uid, habitId: 'h1', date: '2026-01-01' }));
});

test('habits validate settings on create/edit and each daily log or weekly score', async () => {
  const alice = db();
  const value = { name: '운동'.repeat(20), emoji: '🏃‍♂️', anchor: '아침에 커피를 마신 뒤', tinyVersion: '운동복 갈아입기', schedule: { type: 'weekly', count: 3 }, target: { type: 'check' }, startDate: '2026-11-16' };
  const habit = { ...value, uid, logs: {}, archived: false, order: Date.now(), createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(alice, 'habits', 'h1'), habit));
  await assertSucceeds(setDoc(doc(alice, 'habits', 'h2'), { ...habit, schedule: { type: 'weekdays', days: [1, 3, 5] }, target: { type: 'count', value: 10, unit: '회' }, tinyVersion: '' }));
  await assertSucceeds(setDoc(doc(alice, 'habits', 'h3'), { ...habit, schedule: { type: 'daily' }, emoji: '' }));
  await assertSucceeds(setDoc(doc(alice, 'habits', 'h4'), { ...habit, schedule: { type: 'monthly', count: 10 } }));
  await assertSucceeds(setDoc(doc(alice, 'habits', 'h5'), { ...habit, schedule: { type: 'monthdays', days: [1, 15, 31] } }));
  // 하루 계획 칸: 없거나 '' 또는 오전·오후·저녁
  await assertSucceeds(setDoc(doc(alice, 'habits', 'h6'), { ...habit, planSlot: '오전' }));
  await assertSucceeds(setDoc(doc(alice, 'habits', 'h7'), { ...habit, planSlot: '' }));
  const invalid = [
    { schedule: { type: 'monthly', count: 0 } }, { schedule: { type: 'monthly', count: 32 } }, { schedule: { type: 'monthly', count: 3, days: [1] } },
    { schedule: { type: 'monthdays', days: [] } }, { schedule: { type: 'monthdays', days: [0] } }, { schedule: { type: 'monthdays', days: [32] } },
    { schedule: { type: 'monthdays', days: [5, 5] } },
    { name: '' }, { name: '가'.repeat(41) }, { anchor: 'x'.repeat(81) }, { emoji: 'x'.repeat(17) },
    { schedule: { type: 'weekly', count: 8 } }, { schedule: { type: 'weekly' } }, { schedule: { type: 'weekdays', days: [] } },
    { schedule: { type: 'weekdays', days: [1, 1] } }, { schedule: { type: 'weekdays', days: [7] } }, { schedule: { type: 'monthly' } },
    { schedule: { type: 'daily', count: 3 } }, { target: { type: 'count', value: 1, unit: '회' } }, { target: { type: 'count', value: 5, unit: '1234567' } },
    { target: { type: 'check', value: 3 } }, { startDate: 'today' }, { logs: { '2026-11-16': 'full' } }, { archived: true },
    { order: 'first' }, { automaticity: {} }, { extra: 1 },
    { planSlot: '새벽' }, { planSlot: 1 }, { planSlot: null },
  ];
  for (const bad of invalid) await assertFails(setDoc(doc(alice, 'habits', 'bad'), { ...habit, ...bad }));

  // 수정·보관
  await assertSucceeds(updateDoc(doc(alice, 'habits', 'h1'), { ...value, name: '산책', schedule: { type: 'daily' }, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(alice, 'habits', 'h1'), { archived: true, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(alice, 'habits', 'h1'), { schedule: { type: 'weekly', count: 0 }, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(alice, 'habits', 'h1'), { name: '이름', updatedAt: Timestamp.fromMillis(1) }));
  await assertFails(updateDoc(doc(alice, 'habits', 'h1'), { order: 5 }));
  await assertSucceeds(updateDoc(doc(alice, 'habits', 'h1'), { ...value, planSlot: '저녁', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(alice, 'habits', 'h1'), { planSlot: '', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(alice, 'habits', 'h1'), { planSlot: '밤', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(alice, 'habits', 'h1'), { createdAt: serverTimestamp() }));

  // 하루 기록: 앱처럼 logs.<날짜> 한 칸씩
  const log = (id, day, v) => updateDoc(doc(alice, 'habits', id), new FieldPath('logs', day), v);
  for (const [day, v] of [['2026-11-16', 'full'], ['2026-11-17', 'tiny'], ['2026-11-18', 'skip'], ['2026-11-19', 'full']])
    await assertSucceeds(log('h1', day, v));
  await assertSucceeds(log('h1', '2026-11-16', 'skip'));
  await assertSucceeds(log('h1', '2026-11-16', deleteField()));
  await assertSucceeds(log('h2', '2026-11-16', 3));
  await assertSucceeds(log('h2', '2026-11-16', 999));
  for (const [day, v] of [['2026-11-20', 'done'], ['2026-11-20', 0], ['2026-11-20', 1000], ['2026-11-20', 2.5], ['2026-11-20', true], ['2026-11-20', { a: 1 }], ['today', 'full'], ['2026-11-2', 'full']])
    await assertFails(log('h1', day, v));
  await assertFails(updateDoc(doc(alice, 'habits', 'h1'), new FieldPath('logs', '2026-11-20'), 'full', new FieldPath('logs', '2026-11-21'), 'full'));
  await assertFails(updateDoc(doc(alice, 'habits', 'h1'), { logs: { '2026-11-20': 'full', '2026-11-21': 'full' } }));
  assert.deepEqual((await getDoc(doc(alice, 'habits', 'h1'))).data().logs, { '2026-11-17': 'tiny', '2026-11-18': 'skip', '2026-11-19': 'full' });

  // logs가 없던 예전 습관도 기록할 수 있다.
  await seed(['habits', 'old'], { uid, name: '예전 습관', startDate: '2026-01-01' });
  await assertSucceeds(log('old', '2026-11-20', 'full'));

  // 자동화 점수
  const score = (week, s) => updateDoc(doc(alice, 'habits', 'h1'), new FieldPath('automaticity', week), s);
  await assertSucceeds(score('2026-11-16', 4));
  await assertSucceeds(score('2026-11-23', 5));
  for (const [week, s] of [['2026-11-30', 6], ['2026-11-30', 0], ['2026-11-30', '4'], ['week', 3]])
    await assertFails(score(week, s));
});
