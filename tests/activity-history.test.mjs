import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { blockActivity, summarizeBlocks } from '../src/features/planner/activityHistory.mjs';

test('archiving only updates activity metadata and never reads/deletes history', async () => {
  const calls = [];
  const source = fs.readFileSync('src/features/planner/plannerService.js','utf8')
    .replace(/import[\s\S]*?from\s*["'][^"']+["'];/g, '').replace(/export const /g, 'const ');
  const context = vm.createContext({
    db: {}, doc: (_db, name, id) => ({ name, id }),
    serverTimestamp: () => 'server-time',
    updateDoc: async (ref, data) => calls.push({ ref, data }),
    getDocs: () => assert.fail('Must not scan historical records'),
    deleteDoc: () => assert.fail('Must not delete historical records'),
    writeBatch: () => assert.fail('Must not cascade delete'),
  });
  vm.runInContext(source + '\nglobalThis.archive = deleteActivity;', context);
  await context.archive('alice', 'journal');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ref.name, 'plannerActivities');
  assert.equal(calls[0].ref.id, 'journal');
  assert.equal(calls[0].data.archived, true);
  assert.equal(calls[0].data.archivedAt, 'server-time');
  assert.throws(() => context.archive(null, 'journal'));
});

test('archived, custom, rest and orphan records are all counted', () => {
  const map = {
    journal: { name: '일기', color: '#112233', archived: true },
    rest: { name: '휴식', color: '#445566' },
  };
  const blocks = [
    { activityId: 'journal', startMin: 0, endMin: 10 },
    { activityId: 'journal', startMin: 20, endMin: 30 },
    { activityId: 'rest', startMin: 30, endMin: 40 },
    { customName: '직접 입력', customColor: '#778899', startMin: 40, endMin: 55 },
    { activityId: 'missing', startMin: 55, endMin: 60 },
  ];
  const stats = summarizeBlocks(blocks, map);
  assert.equal(stats.length, 4);
  assert.equal(stats.reduce((sum, s) => sum + s.mins, 0), 50);
  assert.equal(stats.find(s => s.name === '일기').mins, 20);
  assert.ok(stats.some(s => s.name === '휴식'));
  assert.ok(stats.some(s => s.name === '삭제된 활동'));
  assert.equal(summarizeBlocks(blocks, { ...map, journal: { ...map.journal, archived: false } })[0].mins, stats[0].mins);
});

test('new snapshots survive missing metadata and old slot/hour records remain counted', () => {
  const snapshot = { activityId: 'removed', activityName: '과거 활동', activityColor: '#112233', startSlot: 0, endSlot: 2 };
  assert.equal(blockActivity(snapshot, {}).name, '과거 활동');
  assert.equal(blockActivity(snapshot, {}).color, '#112233');
  const stats = summarizeBlocks([snapshot, { ...snapshot, startSlot: undefined, endSlot: undefined, startHour: 9, endHour: 10 }], {});
  assert.equal(stats[0].mins, 90);
  assert.equal(stats[0].hours, 1.5);
});

test('same-named different activity IDs are not merged; custom repeats are aggregated', () => {
  const map = { old: { name: '독서' }, newer: { name: '독서' } };
  const blocks = ['old', 'newer'].map(activityId => ({ activityId, startMin: 0, endMin: 10 }));
  blocks.push(...Array.from({ length: 2 }, () => ({ customName: '독서', startMin: 0, endMin: 5 })));
  const stats = summarizeBlocks(blocks, map);
  assert.equal(stats.length, 3);
  assert.equal(stats.reduce((sum, s) => sum + s.mins, 0), 30);
  assert.deepEqual(summarizeBlocks([{ startMin: 4, endMin: 1 }, { startMin: 3 }], {}), []);
});
