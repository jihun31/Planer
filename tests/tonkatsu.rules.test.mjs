// 돈까스봇 공용 데이터 보안 규칙 테스트 (docs/tonkatsu-integration.md)
// 에뮬레이터의 실제 시각을 기준으로 검사하므로, 날짜는 테스트 실행 시점의 한국 시간 5시 기준으로 계산합니다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, collection, query, where, writeBatch, serverTimestamp, deleteField, Timestamp } from 'firebase/firestore';

const ALICE = { uid: 'tk-alice-uid', discordId: '100000000000000001' };
const BOB = { uid: 'tk-bob-uid', discordId: '100000000000000002' };
const STRANGER_UID = 'tk-stranger-uid'; // Google 로그인은 했지만 디스코드 연동 안 함

// 한국 시간 5시 경계 기준 날짜 (offset: 0 오늘, -1 어제, 1 내일)
function kstDay(offset = 0) {
  return new Date(Date.now() + (9 - 5) * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
}
const TODAY = kstDay(0), YESTERDAY = kstDay(-1), TWO_DAYS_AGO = kstDay(-2), TOMORROW = kstDay(1);
const MONTH = TODAY.slice(0, 7);

let env;
const db = uid => env.authenticatedContext(uid).firestore();
const guest = () => env.unauthenticatedContext().firestore();
const seed = fn => env.withSecurityRulesDisabled(context => fn(context.firestore()));

function planData(owner, overrides = {}) {
  return {
    ownerId: owner.discordId, category: 'Daily', content: '운동', photo: false,
    startDate: TODAY, status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    ...overrides,
  };
}
const seededPlan = (owner, overrides = {}) => ({
  ...planData(owner, overrides), startDate: overrides.startDate ?? TWO_DAYS_AGO,
  createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
});
const checkIn = (owner, planId, date, extra = {}) => ({
  planId, ownerId: owner.discordId, date, source: 'app', createdAt: serverTimestamp(), ...extra,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-planer-security',
    firestore: { host: '127.0.0.1', port: 8088, rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
  await seed(async f => {
    for (const m of [ALICE, BOB]) {
      await setDoc(doc(f, 'links', m.uid), { uid: m.uid, discordId: m.discordId, linkedAt: Timestamp.now() });
      await setDoc(doc(f, 'members', m.discordId), { discordId: m.discordId, displayName: m.uid, uid: m.uid, alertHour: 2, fines: 3000, createdAt: Timestamp.now() });
    }
    await setDoc(doc(f, 'server', 'info'), { guildId: '200000000000000000', name: '돈까스 스터디', iconUrl: null });
    await setDoc(doc(f, 'plans', 'tk-alice-daily'), seededPlan(ALICE));
    await setDoc(doc(f, 'plans', 'tk-alice-photo'), seededPlan(ALICE, { content: '사진 운동', photo: true }));
    await setDoc(doc(f, 'plans', 'tk-alice-limit'), seededPlan(ALICE, { category: 'Limit', content: '몬스터', period: 'week', limit: 2 }));
    await setDoc(doc(f, 'plans', 'tk-alice-new'), seededPlan(ALICE, { content: '오늘 등록', startDate: TODAY }));
    await setDoc(doc(f, 'plans', 'tk-alice-deleted'), seededPlan(ALICE, { content: '삭제됨', status: 'deleted' }));
    await setDoc(doc(f, 'plans', 'tk-alice-goal'), seededPlan(ALICE, { category: 'OneTime', content: '접수', deadline: TOMORROW }));
    await setDoc(doc(f, 'plans', 'tk-bob-daily'), seededPlan(BOB, { content: '독서' }));
    await setDoc(doc(f, 'checkIns', `tk-alice-daily_${TWO_DAYS_AGO}`), { ...checkIn(ALICE, 'tk-alice-daily', TWO_DAYS_AGO), createdAt: Timestamp.now() });
    await setDoc(doc(f, 'checkIns', `tk-bob-daily_${TODAY}`), { ...checkIn(BOB, 'tk-bob-daily', TODAY, { source: 'discord' }), createdAt: Timestamp.now() });
    await setDoc(doc(f, 'fineEvents', 'tk-fine'), { discordId: BOB.discordId, amount: 3000, reason: '테스트', date: YESTERDAY, kind: 'settlement', createdAt: Timestamp.now() });
    await setDoc(doc(f, 'votes', 'tk-vote'), { target_id: BOB.discordId });
    await setDoc(doc(f, 'botState', 'state'), { last_settlement_date: YESTERDAY });
    await setDoc(doc(f, 'linkCodes', 'BOBCODE2'), { uid: BOB.uid, createdAt: Timestamp.now() });
  });
});
after(async () => { await env?.cleanup(); });

test('연동된 멤버만 공용 데이터를 읽고, 서로의 진행도를 볼 수 있음', async () => {
  const alice = db(ALICE.uid);
  for (const path of [['server', 'info'], ['members', BOB.discordId], ['plans', 'tk-bob-daily'],
    ['checkIns', `tk-bob-daily_${TODAY}`], ['fineEvents', 'tk-fine'], ['votes', 'tk-vote']]) {
    await assertSucceeds(getDoc(doc(alice, ...path)));
    await assertFails(getDoc(doc(db(STRANGER_UID), ...path)));
    await assertFails(getDoc(doc(guest(), ...path)));
  }
  // 멤버 탭: 다른 멤버의 계획·인증 목록 조회
  await assertSucceeds(getDocs(query(collection(alice, 'plans'), where('ownerId', '==', BOB.discordId))));
  await assertSucceeds(getDocs(query(collection(alice, 'checkIns'), where('date', 'in', [TODAY, YESTERDAY]))));
  await assertFails(getDocs(collection(db(STRANGER_UID), 'plans')));
  // 봇 내부 상태는 아무도 못 읽음
  await assertFails(getDoc(doc(alice, 'botState', 'state')));
});

test('연동 정보와 봇 전용 데이터는 앱에서 쓸 수 없음', async () => {
  const alice = db(ALICE.uid), stranger = db(STRANGER_UID);
  await assertSucceeds(getDoc(doc(alice, 'links', ALICE.uid)));
  await assertFails(getDoc(doc(alice, 'links', BOB.uid)));
  await assertSucceeds(getDoc(doc(stranger, 'links', STRANGER_UID))); // 연동 여부 확인용 (없는 문서)
  // 스스로 연동하기, 남의 디스코드 ID 가로채기
  await assertFails(setDoc(doc(stranger, 'links', STRANGER_UID), { uid: STRANGER_UID, discordId: BOB.discordId, linkedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(alice, 'links', ALICE.uid), { discordId: BOB.discordId }));
  for (const [name, id, data] of [
    ['server', 'info', { name: '해킹' }],
    ['members', '999999999999', { discordId: '999999999999' }],
    ['fineEvents', 'forged', { discordId: ALICE.discordId, amount: -30000 }],
    ['votes', 'forged', { target_id: ALICE.discordId }],
    ['botState', 'state', { last_settlement_date: TOMORROW }],
  ]) await assertFails(setDoc(doc(alice, name, id), data));
  await assertFails(deleteDoc(doc(alice, 'fineEvents', 'tk-fine')));
});

test('연동 코드: 본인 uid로만 만들고, 덮어쓰거나 남의 코드를 읽을 수 없음', async () => {
  const stranger = db(STRANGER_UID);
  const code = doc(stranger, 'linkCodes', 'ABCD2345');
  await assertSucceeds(setDoc(code, { uid: STRANGER_UID, createdAt: serverTimestamp() }));
  await assertFails(getDoc(code)); // 코드는 봇만 확인
  for (const bad of ['abcd2345', 'ABCD234', 'ABCD23450', 'ABCD234O', 'ABCD2341'])
    await assertFails(setDoc(doc(stranger, 'linkCodes', bad), { uid: STRANGER_UID, createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(stranger, 'linkCodes', 'EFGH2345'), { uid: ALICE.uid, createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(stranger, 'linkCodes', 'EFGH2346'), { uid: STRANGER_UID, createdAt: serverTimestamp(), discordId: BOB.discordId }));
  await assertFails(setDoc(doc(stranger, 'linkCodes', 'BOBCODE2'), { uid: STRANGER_UID, createdAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(stranger, 'linkCodes', 'BOBCODE2')));
  await assertFails(setDoc(doc(guest(), 'linkCodes', 'GUEST234'), { uid: 'x', createdAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(code));
});

test('알림 시간: 본인만, 0~23시만 바꿀 수 있음', async () => {
  const alice = db(ALICE.uid);
  await assertSucceeds(updateDoc(doc(alice, 'members', ALICE.discordId), { alertHour: 23 }));
  await assertFails(updateDoc(doc(alice, 'members', ALICE.discordId), { alertHour: 24 }));
  await assertFails(updateDoc(doc(alice, 'members', ALICE.discordId), { alertHour: '3' }));
  await assertFails(updateDoc(doc(alice, 'members', ALICE.discordId), { fines: 0 }));
  await assertFails(updateDoc(doc(alice, 'members', ALICE.discordId), { alertHour: 5, uid: BOB.uid }));
  await assertFails(updateDoc(doc(alice, 'members', BOB.discordId), { alertHour: 5 }));
  await assertFails(updateDoc(doc(db(STRANGER_UID), 'members', ALICE.discordId), { alertHour: 5 }));
});

test('계획 등록: 본인 계획만, 카테고리별 형식 검사, 등록일은 오늘', async () => {
  const alice = db(ALICE.uid);
  const valid = [
    {},
    { category: 'Weekly', count: 3 },
    { category: 'Monthly', count: 31 },
    { category: 'Routine', days: ['월', '수', '금'] },
    { category: 'Interval', interval: 3 },
    { category: 'OneTime', deadline: '2026-12-31' },
    { category: 'Limit', period: 'week', limit: 2 },
    { category: 'Limit', period: 'day', limit: 0 },
    { photo: true, content: 'x'.repeat(80) },
  ];
  for (const [i, overrides] of valid.entries())
    await assertSucceeds(setDoc(doc(alice, 'plans', `tk-new-${i}`), planData(ALICE, overrides)));

  const invalid = [
    { ownerId: BOB.discordId },                       // 남의 계획
    { ownerId: 'not-a-discord-id' },
    { startDate: TOMORROW },                          // 미래 등록일로 정산 피하기
    { startDate: YESTERDAY },
    { status: 'completed', completedAt: TODAY },
    { status: 'deleted' },
    { content: '' }, { content: 'x'.repeat(81) },
    { photo: 'yes' },
    { category: 'Unknown' },
    { count: 3 },                                      // 일일 계획에 다른 카테고리 필드
    { category: 'Weekly' }, { category: 'Weekly', count: 0 }, { category: 'Weekly', count: 8 },
    { category: 'Monthly', count: 32 },
    { category: 'Routine', days: [] }, { category: 'Routine', days: ['월', '월'] }, { category: 'Routine', days: ['Mon'] },
    { category: 'Interval', interval: 0 }, { category: 'Interval', interval: 366 },
    { category: 'OneTime', deadline: '2026/12/31' },
    { category: 'Limit', period: 'year', limit: 2 }, { category: 'Limit', period: 'week', limit: 51 },
    { category: 'Limit', period: 'week', limit: -1 }, { category: 'Limit', period: 'week', limit: 2, photo: true },
    { extra: true },
    { createdAt: Timestamp.fromMillis(0) },
  ];
  for (const [i, overrides] of invalid.entries())
    await assertFails(setDoc(doc(alice, 'plans', `tk-bad-${i}`), planData(ALICE, overrides)));
  await assertFails(setDoc(doc(db(STRANGER_UID), 'plans', 'tk-stranger'), planData({ discordId: '100000000000000009' })));
  // 이미 있는 계획을 새로 만드는 것처럼 덮어쓰기
  await assertFails(setDoc(doc(alice, 'plans', 'tk-bob-daily'), planData(ALICE)));
});

test('계획 수정: 이름 변경과 삭제만 가능, 조건(횟수·제한)은 못 바꿈', async () => {
  const alice = db(ALICE.uid);
  await seed(f => setDoc(doc(f, 'plans', 'tk-edit'), seededPlan(ALICE, { category: 'Weekly', count: 3 })));
  const ref = doc(alice, 'plans', 'tk-edit');
  await assertSucceeds(updateDoc(ref, { content: '코딩 공부', updatedAt: serverTimestamp() }));
  for (const change of [{ count: 1 }, { category: 'Daily' }, { ownerId: BOB.discordId }, { photo: true },
    { startDate: TODAY }, { status: 'completed', completedAt: TODAY }, { content: '' }])
    await assertFails(updateDoc(ref, { ...change, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { content: '시각 누락' })); // updatedAt 필수
  await assertFails(updateDoc(doc(db(BOB.uid), 'plans', 'tk-edit'), { content: '침입', updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(ref)); // 실제 삭제 대신 status
  await assertSucceeds(updateDoc(ref, { status: 'deleted', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { status: 'active', updatedAt: serverTimestamp() })); // 삭제 복구 불가
  await assertFails(updateDoc(ref, { content: '삭제 후 수정', updatedAt: serverTimestamp() }));
});

test('인증: 사진 없는 본인 계획을 오늘·어제만, 하루 한 번', async () => {
  const alice = db(ALICE.uid);
  const id = date => `tk-alice-daily_${date}`;
  await assertSucceeds(setDoc(doc(alice, 'checkIns', id(TODAY)), checkIn(ALICE, 'tk-alice-daily', TODAY)));
  await assertSucceeds(setDoc(doc(alice, 'checkIns', id(YESTERDAY)), checkIn(ALICE, 'tk-alice-daily', YESTERDAY)));
  // 같은 날 두 번 (같은 문서) → 덮어쓰기 불가
  await assertFails(setDoc(doc(alice, 'checkIns', id(TODAY)), checkIn(ALICE, 'tk-alice-daily', TODAY)));
  // 날짜 조작
  await assertFails(setDoc(doc(alice, 'checkIns', id('2026-01-0X')), checkIn(ALICE, 'tk-alice-daily', '2026-01-0X')));
  await assertFails(setDoc(doc(alice, 'checkIns', id(TOMORROW)), checkIn(ALICE, 'tk-alice-daily', TOMORROW)));
  await assertFails(setDoc(doc(alice, 'checkIns', 'tk-alice-daily_old'), checkIn(ALICE, 'tk-alice-daily', '2026-01-01')));
  await assertFails(setDoc(doc(alice, 'checkIns', `tk-alice-photo_${TODAY}`), checkIn(ALICE, 'tk-alice-photo', TODAY))); // 사진 필수
  await assertFails(setDoc(doc(alice, 'checkIns', `tk-alice-deleted_${TODAY}`), checkIn(ALICE, 'tk-alice-deleted', TODAY)));
  await assertFails(setDoc(doc(alice, 'checkIns', `tk-alice-new_${YESTERDAY}`), checkIn(ALICE, 'tk-alice-new', YESTERDAY))); // 등록 전 날짜
  await assertSucceeds(setDoc(doc(alice, 'checkIns', `tk-alice-new_${TODAY}`), checkIn(ALICE, 'tk-alice-new', TODAY)));
  await assertFails(setDoc(doc(alice, 'checkIns', `tk-missing_${TODAY}`), checkIn(ALICE, 'tk-missing', TODAY)));
  // 남의 계획 / 남인 척
  await assertFails(setDoc(doc(alice, 'checkIns', `tk-bob-daily_${YESTERDAY}`), checkIn(ALICE, 'tk-bob-daily', YESTERDAY)));
  await assertFails(setDoc(doc(alice, 'checkIns', `tk-bob-daily_${YESTERDAY}`), checkIn(BOB, 'tk-bob-daily', YESTERDAY)));
  await assertFails(setDoc(doc(db(STRANGER_UID), 'checkIns', `tk-alice-daily_${TODAY}x`), checkIn(ALICE, 'tk-alice-daily', TODAY)));
  // 형식
  await assertFails(setDoc(doc(alice, 'checkIns', 'random-id'), checkIn(ALICE, 'tk-alice-new', TODAY)));
  await assertFails(setDoc(doc(alice, 'checkIns', `tk-alice-new_${TODAY}`), checkIn(ALICE, 'tk-alice-new', TODAY, { source: 'discord' })));
  await assertFails(setDoc(doc(alice, 'checkIns', `tk-alice-new_${TODAY}`), checkIn(ALICE, 'tk-alice-new', TODAY, { messageUrl: 'https://x' })));
  // 취소: 본인·최근 기록만
  await assertSucceeds(deleteDoc(doc(alice, 'checkIns', id(YESTERDAY))));
  await assertFails(deleteDoc(doc(alice, 'checkIns', id(TWO_DAYS_AGO))));
  await assertFails(deleteDoc(doc(alice, 'checkIns', `tk-bob-daily_${TODAY}`)));
  await assertFails(updateDoc(doc(alice, 'checkIns', id(TODAY)), { date: YESTERDAY }));
});

test('제한 계획: 같은 날 여러 번 기록 가능', async () => {
  const alice = db(ALICE.uid);
  for (const n of [1, 2, 3])
    await assertSucceeds(setDoc(doc(alice, 'checkIns', `tk-limit-${n}`), checkIn(ALICE, 'tk-alice-limit', TODAY)));
  const today = await getDocs(query(collection(alice, 'checkIns'), where('planId', '==', 'tk-alice-limit')));
  assert.equal(today.size, 3);
  await assertSucceeds(deleteDoc(doc(alice, 'checkIns', 'tk-limit-3')));
});

test('목표 달성: 인증과 함께일 때만 completed, 인증을 지울 때만 되돌림', async () => {
  const alice = db(ALICE.uid);
  const plan = doc(alice, 'plans', 'tk-alice-goal'), record = doc(alice, 'checkIns', `tk-alice-goal_${TODAY}`);
  // 인증 없이 달성 처리
  await assertFails(updateDoc(plan, { status: 'completed', completedAt: TODAY, updatedAt: serverTimestamp() }));
  const complete = writeBatch(alice);
  complete.set(record, checkIn(ALICE, 'tk-alice-goal', TODAY));
  complete.update(plan, { status: 'completed', completedAt: TODAY, updatedAt: serverTimestamp() });
  await assertSucceeds(complete.commit());
  // 달성한 목표에 또 인증, 다른 필드 수정
  await assertFails(setDoc(doc(alice, 'checkIns', `tk-alice-goal_${YESTERDAY}`), checkIn(ALICE, 'tk-alice-goal', YESTERDAY)));
  await assertFails(updateDoc(plan, { content: '변경', updatedAt: serverTimestamp() }));
  // 인증은 남긴 채 되돌리기
  await assertFails(updateDoc(plan, { status: 'active', completedAt: deleteField(), updatedAt: serverTimestamp() }));
  const undo = writeBatch(alice);
  undo.delete(record);
  undo.update(plan, { status: 'active', completedAt: deleteField(), updatedAt: serverTimestamp() });
  await assertSucceeds(undo.commit());
  assert.equal((await getDoc(plan)).data().status, 'active');
  // 일일 계획은 completed 불가
  const daily = writeBatch(alice);
  daily.update(doc(alice, 'plans', 'tk-alice-daily'), { status: 'completed', completedAt: TODAY, updatedAt: serverTimestamp() });
  await assertFails(daily.commit());
});

test('휴식권: 오늘만, 한 달에 한 번 (문서 ID), 면책은 앱에서 못 만듦', async () => {
  const alice = db(ALICE.uid);
  const restId = `${ALICE.discordId}_rest_${MONTH}`;
  const rest = (date, extra = {}) => ({ ownerId: ALICE.discordId, type: 'rest', date, createdAt: serverTimestamp(), ...extra });
  await assertFails(setDoc(doc(alice, 'offDays', restId), rest(YESTERDAY)));
  await assertFails(setDoc(doc(alice, 'offDays', `${ALICE.discordId}_rest_${TOMORROW.slice(0, 7)}`), rest(TOMORROW)));
  await assertFails(setDoc(doc(alice, 'offDays', `${ALICE.discordId}_rest_${TODAY}`), rest(TODAY))); // ID 형식
  await assertFails(setDoc(doc(alice, 'offDays', `${BOB.discordId}_rest_${MONTH}`), rest(TODAY, { ownerId: BOB.discordId })));
  await assertFails(setDoc(doc(alice, 'offDays', `${ALICE.discordId}_exempt_${TODAY}`), rest(TODAY, { type: 'exempt' })));
  await assertSucceeds(setDoc(doc(alice, 'offDays', restId), rest(TODAY)));
  await assertFails(setDoc(doc(alice, 'offDays', restId), rest(TODAY))); // 같은 달 두 번째
  await assertSucceeds(getDoc(doc(db(BOB.uid), 'offDays', restId)));
  await assertFails(deleteDoc(doc(db(BOB.uid), 'offDays', restId)));
  await assertSucceeds(deleteDoc(doc(alice, 'offDays', restId))); // 오늘 쓴 휴식 취소
  await seed(f => setDoc(doc(f, 'offDays', `${ALICE.discordId}_exempt_${TODAY}`), { ownerId: ALICE.discordId, type: 'exempt', date: TODAY, createdAt: Timestamp.now() }));
  await assertFails(deleteDoc(doc(alice, 'offDays', `${ALICE.discordId}_exempt_${TODAY}`)));
});
