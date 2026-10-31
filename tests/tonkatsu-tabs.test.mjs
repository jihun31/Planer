// 🔥 인증 탭·👥 멤버 탭을 가짜 데이터로 그려서 화면 내용 확인 (Firestore 쓰기 함수는 가짜로 바꿈)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server, render, core;

before(async () => {
  server = await createServer({
    configFile: false, root, logLevel: 'error', appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    resolve: { alias: [{ find: /^.*\/tonkatsuService$/, replacement: path.join(root, 'tests/fixtures/tonkatsu-service-stub.mjs') }] },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  core = await server.ssrLoadModule('/src/features/tonkatsu/tonkatsuCore.mjs');
  const { default: CheckInTab } = await server.ssrLoadModule('/src/components/tabs/CheckInTab.jsx');
  const { default: MembersTab } = await server.ssrLoadModule('/src/components/tabs/MembersTab.jsx');
  render = { check: (props) => renderToStaticMarkup(React.createElement(CheckInTab, props)),
    members: (props) => renderToStaticMarkup(React.createElement(MembersTab, props)) };
});
after(async () => { await server?.close(); });

function fakeData(today) {
  const yesterday = core.addDays(today, -1);
  const plans = [
    { id: 'p-daily', ownerId: 'A', category: 'Daily', content: '운동', photo: false, startDate: '2026-01-01', status: 'active' },
    { id: 'p-photo', ownerId: 'A', category: 'Daily', content: '사진운동', photo: true, startDate: '2026-01-01', status: 'active' },
    { id: 'p-limit', ownerId: 'A', category: 'Limit', content: '몬스터', period: 'day', limit: 1, photo: false, startDate: '2026-01-01', status: 'active' },
    { id: 'p-goal', ownerId: 'A', category: 'OneTime', content: '접수', deadline: core.addDays(today, 3), photo: false, startDate: '2026-01-01', status: 'completed', completedAt: today },
    { id: 'p-b', ownerId: 'B', category: 'Weekly', content: '독서', count: 2, photo: false, startDate: '2026-01-01', status: 'active' },
  ];
  const checkIns = [
    { id: 'p-daily_' + today, planId: 'p-daily', ownerId: 'A', date: today },
    { id: 'l1', planId: 'p-limit', ownerId: 'A', date: today }, { id: 'l2', planId: 'p-limit', ownerId: 'A', date: today },
    { id: 'p-goal_' + today, planId: 'p-goal', ownerId: 'A', date: today },
    { id: 'p-b_' + today, planId: 'p-b', ownerId: 'B', date: today, messageUrl: 'https://discord.com/channels/1/2/3' },
    { id: 'evil', planId: 'p-b', ownerId: 'B', date: yesterday, messageUrl: 'javascript:alert(1)' },
  ];
  const members = [{ id: 'A', displayName: '앨리스', fines: 3000, uid: 'u' }, { id: 'B', displayName: '밥', fines: 9000, uid: null }];
  const offDays = [{ id: 'B_exempt_' + today, ownerId: 'B', type: 'exempt', date: today }];
  const views = core.buildViews({ plans, checkIns, offDays, members });
  return {
    ready: true, error: null, today, views, members, checkIns, offDays,
    votes: [{ id: '42', target_id: 'B', target_dates: [today], reason: '병원', agreed_users: [], denied_users: [], required_votes: 1 }],
    myFines: [{ id: 'f1', amount: 3000, date: yesterday, reason: '[일일]운동', kind: 'settlement' }, { id: 'f2', amount: -3000, date: today, reason: '납부', kind: 'admin' }],
    me: views.A,
  };
}

test('인증 탭: 인증 버튼·사진 안내·제한 횟수·달성 목표·벌금 내역', () => {
  const t = fakeData(core.baseDate());
  const html = render.check({ tonkatsu: t, discordId: 'A' });
  assert.match(html, /운동/);
  assert.match(html, /📸 디스코드에서 사진과 함께 인증/); // 사진 필수는 앱에서 인증 불가
  assert.match(html, /\+1 기록/);                         // 제한 계획은 여러 번
  assert.match(html, /\[제한 하루 2\/1회\]/);             // 초과 표시
  assert.match(html, /이날 달성한 목표/);
  assert.match(html, /되돌리기/);
  assert.match(html, /내 벌금 3,000원/);
  assert.match(html, /납부/);
  assert.match(html, /오늘 휴식하기/);
  // 운동은 이미 인증 → 인증 버튼 없이 취소만 (버튼 수: 사진운동 X, 운동 X, 몬스터 +1 기록)
  assert.equal((html.match(/>인증</g) || []).length, 0);
  assert.equal((html.match(/>취소</g) || []).length, 2); // 운동, 몬스터
  assert.doesNotMatch(html, /밥/); // 다른 사람 계획은 안 보임
});

test('인증 탭: 불러오는 중·오류·계획 없음', () => {
  const t = fakeData(core.baseDate());
  assert.match(render.check({ tonkatsu: { ...t, ready: false }, discordId: 'A' }), /불러오는 중/);
  assert.match(render.check({ tonkatsu: { ...t, error: new Error('x') }, discordId: 'A' }), /불러오지 못했어요/);
  assert.match(render.check({ tonkatsu: { ...t, me: { completed_goals: [], rest_history: [], exemptions: [], fines: 0 } }, discordId: 'C' }), /등록된 계획이 없어요/);
});

test('멤버 탭: 멤버별 진행도, 면책 투표, 벌금 순위, 안전한 링크만', () => {
  const t = fakeData(core.baseDate());
  const html = render.members({ tonkatsu: t, discordId: 'A', serverName: '돈까스 스터디' });
  assert.match(html, /돈까스 스터디 진행 상황/);
  const list = html.slice(html.indexOf('tk-members'));
  assert.ok(list.indexOf('앨리스') < list.indexOf('밥'), '내가 맨 위');
  assert.match(html, /앨리스 \(나\)/);
  assert.match(html, /오늘 1\/2/);                 // 앨리스: 운동 완료, 사진운동 미완료
  assert.match(html, /제한 초과 1/);
  assert.match(html, /🛡️ 오늘 면책/);             // 밥
  assert.match(html, /title="Planer 앱 미연동/);   // 밥은 디스코드만
  assert.match(html, /진행 중인 면책 투표/);
  assert.match(html, /찬성 0\/1/);
  assert.match(html, /명예의 전당/);
  assert.ok(html.indexOf('9,000원</strong>') < html.indexOf('3,000원</strong>'), '벌금 많은 순');
  assert.doesNotMatch(html, /javascript:/);
});
