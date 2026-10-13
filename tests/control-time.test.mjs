import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { excludeStudyTime, overlapsStudy } from '../src/features/planner/controlTime.mjs';
import { summarizeBlocks } from '../src/features/planner/activityHistory.mjs';
import { isControlBlock, isStudyBlock } from '../src/features/planner/blockKind.mjs';

test('one block collection classifies old study records and new control records', () => {
  assert.equal(isStudyBlock({ date: '2026-10-12' }), true);
  assert.equal(isStudyBlock({ kind: 'study' }), true);
  assert.equal(isControlBlock({ kind: 'control' }), true);
  assert.equal(isStudyBlock({ kind: 'control' }), false);
});

test('legacy control migration copies and removes records in bounded atomic batches', async () => {
  const source = fs.readFileSync('src/features/planner/controlService.js', 'utf8');
  const body = source.slice(source.indexOf('export async function migrateLegacyControlBlocks'),
    source.indexOf('\nexport const addControlActivity')).replace('export ', '');
  const oldDocs = Array.from({ length: 201 }, (_, i) => ({
    id: `old-${i}`, ref: { collection: 'controlBlocks', id: `old-${i}` },
    data: () => ({ uid: 'alice', date: '2026-10-12', startMin: i, endMin: i + 1, createdAt: 123 }),
  }));
  const committed = [];
  const queries = [];
  const context = vm.createContext({
    db: {},
    collection: (_db, name) => name,
    where: (...parts) => parts,
    query: (...parts) => { queries.push(parts); return parts; },
    getDocs: async () => ({ docs: oldDocs }),
    doc: (_db, collectionName, id) => ({ collection: collectionName, id }),
    writeBatch: () => {
      const operations = [];
      return {
        set: (ref, data) => operations.push({ action: 'set', ref, data }),
        delete: ref => operations.push({ action: 'delete', ref }),
        commit: async () => committed.push(operations),
      };
    },
  });
  vm.runInContext(body + '\nglobalThis.migrate = migrateLegacyControlBlocks;', context);
  await context.migrate('alice');
  assert.equal(queries[0][0], 'controlBlocks');
  assert.equal(queries[0][1][2], 'alice');
  assert.deepEqual(committed.map(batch => batch.length), [400, 2]);
  assert.equal(committed[0][0].ref.collection, 'scheduleBlocks');
  assert.equal(committed[0][0].ref.id, 'legacy-control-alice-old-0');
  assert.equal(committed[0][0].data.kind, 'control');
  assert.equal(committed[0][0].data.createdAt, 123);
  assert.equal(committed[0][1].action, 'delete');
  assert.equal(committed[0][1].ref.collection, 'controlBlocks');
});

test('new control blocks and timer segments use the shared collection', async () => {
  const source = fs.readFileSync('src/features/planner/controlService.js', 'utf8');
  const body = source.slice(source.indexOf('export const addControlBlock')).replaceAll('export const ', 'const ');
  const added = [], timerWrites = [];
  const context = vm.createContext({
    db: {},
    collection: (_db, name) => name,
    doc: (_db, name, id) => ({ name, id }),
    serverTimestamp: () => 123,
    addDoc: async (name, data) => added.push({ name, data }),
    deleteDoc: async () => {},
    writeBatch: () => ({
      set: (ref, data) => timerWrites.push({ ref, data }),
      commit: async () => {},
    }),
  });
  vm.runInContext(body + '\nglobalThis.add = addControlBlock; globalThis.save = saveControlTimer;', context);
  await context.add('alice', { date: '2026-10-12', startMin: 0, endMin: 10 });
  await context.save('alice', {
    startTs: 99, segments: [{ date: '2026-10-12', startMin: 10, endMin: 20 }], metadata: {},
  });
  assert.equal(added[0].name, 'scheduleBlocks');
  assert.equal(added[0].data.kind, 'control');
  assert.equal(timerWrites[0].ref.name, 'scheduleBlocks');
  assert.equal(timerWrites[0].ref.id, 'control_alice_timer_99_0');
  assert.equal(timerWrites[0].data.kind, 'control');
});

test('study time masks leisure records and monthly totals without changing saved data', () => {
  const leisure = [
    { id: 'rest', date: '2026-10-11', startMin: 0, endMin: 60, customName: '휴식', group: 'controlled' },
    { id: 'scroll', date: '2026-10-12', startMin: 0, endMin: 30, customName: '쇼츠', group: 'foolish' },
  ];
  const study = [
    { date: '2026-10-11', startMin: 15, endMin: 45 },
    { date: '2026-10-12', startMin: 0, endMin: 30 },
  ];
  const result = excludeStudyTime(leisure, study);
  assert.deepEqual(result.map(({ date, startMin, endMin }) => [date, startMin, endMin]), [
    ['2026-10-11', 0, 15], ['2026-10-11', 45, 60],
  ]);
  assert.equal(summarizeBlocks(result, {})[0].mins, 30);
  assert.equal(leisure[0].endMin, 60);
});

test('overlap uses half-open minute intervals and handles legacy study blocks', () => {
  const study = [{ date: '2026-10-11', startSlot: 1, endSlot: 2 }];
  assert.equal(overlapsStudy({ date: '2026-10-11', startMin: 0, endMin: 15 }, study), false);
  assert.equal(overlapsStudy({ date: '2026-10-11', startMin: 15, endMin: 30 }, study), true);
  assert.equal(overlapsStudy({ date: '2026-10-12', startMin: 15, endMin: 30 }, study), false);
});
