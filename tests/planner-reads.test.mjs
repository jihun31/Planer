import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { monthDates, selectedDateOutsideMonth, subscribeDateGroups } from '../src/features/planner/blockSubscriptions.mjs';
import { colorizeControlBlocks } from '../src/features/planner/controlColors.mjs';
import { excludeStudyTime } from '../src/features/planner/controlTime.mjs';
import { isControlBlock, isStudyBlock } from '../src/features/planner/blockKind.mjs';

test('month boundaries, leap years, and 31st day', () => {
  assert.equal(monthDates(2024, 1).length, 29);
  assert.equal(monthDates(2026, 1).length, 28);
  assert.equal(monthDates(2026, 8).length, 30);
  assert.equal(monthDates(2026, 11).at(-1), '2026-12-31');
  assert.equal(monthDates(2027, 0)[0], '2027-01-01');
  assert.equal(selectedDateOutsideMonth(2026, 8, '2026-09-01'), '');
  assert.equal(selectedDateOutsideMonth(2027, 0, '2026-12-31'), '2026-12-31');
});

test('31-day query respects limit, waits for both groups, replaces snapshots without double counting', () => {
  const watchers = [], received = [];
  const stop = subscribeDateGroups(monthDates(2026, 9), (dates, cb, fail) => {
    const watcher = { dates, cb, fail, stopped: false };
    watchers.push(watcher);
    return () => { watcher.stopped = true; };
  }, rows => received.push(rows), assert.fail);
  assert.deepEqual(watchers.map(w => w.dates.length), [30, 1]);
  watchers[0].cb([{ id: 'a', startMin: 1, endMin: 11 }]);
  assert.equal(received.length, 0);
  watchers[1].cb([{ id: 'b', startMin: 1, endMin: 6 }]);
  assert.equal(received.at(-1).reduce((n, r) => n + r.endMin - r.startMin, 0), 15);
  watchers[0].cb([{ id: 'a', startMin: 1, endMin: 21 }]);
  assert.equal(received.at(-1).length, 2);
  assert.equal(received.at(-1).reduce((n, r) => n + r.endMin - r.startMin, 0), 25);
  watchers[0].cb([]);
  assert.deepEqual(received.at(-1).map(r => r.id), ['b']);
  stop();
  assert.ok(watchers.every(w => w.stopped));
  const count = received.length;
  watchers[1].cb([{ id: 'late' }]);
  assert.equal(received.length, count);
});

test('empty date selection opens no listener; failed group cancels peers', () => {
  let called = false;
  subscribeDateGroups([], () => assert.fail(), rows => { called = true; assert.deepEqual(rows, []); }, assert.fail)();
  assert.ok(called);
  const watchers = [], errors = [];
  subscribeDateGroups(monthDates(2026, 9), (_dates, cb, fail) => {
    const w = { cb, fail, stopped: false }; watchers.push(w);
    return () => { w.stopped = true; };
  }, assert.fail, e => errors.push(e));
  watchers[0].fail(new Error('permission-denied'));
  assert.equal(errors.length, 1);
  assert.ok(watchers.every(w => w.stopped));
  watchers[1].cb([]);
  watchers[1].fail(new Error('late'));
  assert.equal(errors.length, 1);
});

test('actual service queries always include UID and bounded dates, never a global history query', () => {
  const queries = [];
  const source = fs.readFileSync(new URL('../src/features/planner/plannerService.js', import.meta.url), 'utf8')
    .replace(/import[\s\S]*?from\s*["'][^"']+["'];/g, '').replace(/export const /g, 'const ');
  const context = vm.createContext({
    db: {}, subscribeDateGroups,
    collection: (_db, name) => name,
    where: (field, op, value) => ({ field, op, value }),
    query: (collection, ...filters) => ({ collection, filters }),
    onSnapshot: q => { queries.push(q); return () => {}; },
  });
  vm.runInContext(source + '\nglobalThis.subscribe = subscribeBlocks;', context);
  context.subscribe('alice', monthDates(2026, 9), () => {}, assert.fail);
  assert.equal(queries.length, 2);
  for (const q of queries) {
    assert.equal(q.collection, 'scheduleBlocks');
    assert.equal(q.filters[0].field, 'uid');
    assert.equal(q.filters[0].value, 'alice');
    assert.equal(q.filters[1].field, 'date');
    assert.equal(q.filters[1].op, 'in');
    assert.ok(q.filters[1].value.every(d => d.startsWith('2026-10-')));
    assert.ok(q.filters[1].value.length <= 30);
  }
});

// Small hook harness: execute the real hook and simulate effect lifecycle,
// including StrictMode cleanup before queued subscription setup.
function harness() {
  const slots = [], pending = [], watchers = [], writes = [];
  let cursor = 0;
  const same = (a, b) => a && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const subscribe = (uid, dates, cb, onError) => {
    const w = { uid, dates, cb, onError, stopped: false };
    watchers.push(w);
    return () => { w.stopped = true; };
  };
  const noop = () => {};
  const context = vm.createContext({
    queueMicrotask, monthDates, selectedDateOutsideMonth, colorizeControlBlocks, excludeStudyTime,
    isControlBlock, isStudyBlock,
    subscribeActivities: (uid, cb, err) => subscribe(uid, 'activities', cb, err),
    subscribeAllBlocks: subscribe,
    subscribeControlActivities: (uid, cb, err) => subscribe(uid, 'control-activities', cb, err),
    addActivity: noop, deleteActivity: noop, addBlock: (...args) => writes.push(args), deleteBlock: noop, updateActivityOrder: noop,
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: initial };
      return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }];
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn, deps };
      return slots[i].value;
    },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps };
      return slots[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        slots[i]?.cleanup?.();
        slots[i] = { fn, deps };
        pending.push(() => { slots[i].cleanup = fn(); });
      }
    },
  });
  const source = fs.readFileSync(new URL('../src/features/planner/usePlanner.js', import.meta.url), 'utf8')
    .replace(/import[\s\S]*?from\s*["'][^"']+["'];/g, '').replace('export const usePlanner', 'const usePlanner');
  vm.runInContext(source + '\nglobalThis.hook = usePlanner;', context);
  return {
    watchers, writes,
    render(...args) { cursor = 0; const result = context.hook(...args); pending.splice(0).forEach(fn => fn()); return result; },
    strictReplay() { for (const s of slots) if (s.fn) { s.cleanup?.(); s.cleanup = s.fn(); } },
    close() { slots.forEach(s => s.cleanup?.()); },
  };
}
const flush = () => new Promise(resolve => queueMicrotask(resolve));

test('StrictMode, repeated renders and same-month date changes do not duplicate subscriptions', async () => {
  const h = harness();
  h.render('alice', 2026, 8, '2026-09-01');
  h.strictReplay();
  await flush();
  assert.equal(h.watchers.length, 3); // two activity lists + one shared block collection
  h.watchers.forEach(w => w.cb([]));
  assert.equal(h.render('alice', 2026, 8, '2026-09-30').loading, false);
  await flush();
  assert.equal(h.watchers.length, 3);
  h.close();
  assert.ok(h.watchers.every(w => w.stopped));
});

test('selected day in another month is retained without re-querying current month; stale user data is hidden', async () => {
  const h = harness();
  h.render('alice', 2026, 8, '2026-09-30');
  await flush();
  h.watchers[0].cb([]);
  h.watchers[1].cb([{ id: 'old', date: '2026-09-30' }]);
  h.watchers[2].cb([]);
  const loading = h.render('alice', 2026, 9, '2026-09-30');
  assert.ok(loading.loading);
  assert.equal(loading.blocks.length, 0);
  await flush();
  assert.ok(h.watchers[1].stopped);
  assert.equal(h.watchers.length, 5);
  h.watchers[3].cb([{ id: 'oct', date: '2026-10-01' }]);
  h.watchers[4].cb([{ id: 'sep', date: '2026-09-30' }]);
  assert.equal(h.render('alice', 2026, 9, '2026-09-30').blocks.length, 2);
  h.render('alice', 2026, 9, '2026-10-01');
  await flush();
  assert.equal(h.watchers.length, 5);
  assert.ok(h.watchers[4].stopped);
  const next = h.render('bob', 2026, 9, '2026-10-01');
  assert.equal(next.blocks.length, 0);
  assert.equal(next.activities.length, 0);
  h.watchers[3].cb([{ id: 'stale-alice' }]);
  await flush();
  assert.equal(h.render('bob', 2026, 9, '2026-10-01').blocks.length, 0);
  h.close();
});

test('subscription error is exposed and explicit retry reconnects; logout unsubscribes', async () => {
  const h = harness();
  h.render('alice', 2026, 8, '2026-09-30');
  await flush();
  h.watchers[0].cb([]);
  h.watchers[1].onError(new Error('permission-denied'));
  const failed = h.render('alice', 2026, 8, '2026-09-30');
  assert.equal(failed.error.message, 'permission-denied');
  failed.retryLoading();
  h.render('alice', 2026, 8, '2026-09-30');
  await flush();
  assert.equal(h.watchers.length, 6);
  h.watchers.slice(3).forEach(w => w.cb([]));
  assert.equal(h.render('alice', 2026, 8, '2026-09-30').error, null);
  h.render(null, 2026, 8, '2026-09-30');
  assert.ok(h.watchers.every(w => w.stopped));
  h.close();
});


test('archived activities disappear from choices but remain available for historical labels and timer saves', async () => {
  const h = harness();
  h.render('alice', 2026, 9, '2026-10-01'); await flush();
  h.watchers[0].cb([{ id: 'old', name: 'Journal', color: '#112233', archived: true }, { id: 'active', name: 'Work' }]);
  h.watchers[1].cb([]);
  h.watchers[2].cb([]);
  const result = h.render('alice', 2026, 9, '2026-10-01');
  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0].id, 'active');
  assert.equal(result.allActivities.length, 2);
  result.addBlock({ activityId: 'old', date: '2026-10-01', startMin: 1, endMin: 11 });
  assert.equal(h.writes[0][0], 'alice');
  assert.equal(h.writes[0][1].activityName, 'Journal');
  assert.equal(h.writes[0][1].activityColor, '#112233');
  h.close();
});

test('time management reads control blocks but keeps study blocks primary', async () => {
  const h = harness();
  h.render('alice', 2026, 9, '2026-10-01'); await flush();
  h.watchers[0].cb([]);
  h.watchers[1].cb([
    { id: 'study', date: '2026-10-01', startMin: 20, endMin: 40 },
    { id: 'control', kind: 'control', activityId: 'leisure', date: '2026-10-01', startMin: 10, endMin: 50 },
  ]);
  h.watchers[2].cb([{ id: 'leisure', group: 'foolish' }]);
  const result = h.render('alice', 2026, 9, '2026-10-01');
  assert.equal(result.blocks.length, 1);
  assert.deepEqual(Array.from(result.oppositeBlocks, b => [b.startMin, b.endMin]), [[10, 20], [40, 50]]);
  assert.equal(result.oppositeBlocks[0].activityColor, '#dc2626');
  h.close();
});
