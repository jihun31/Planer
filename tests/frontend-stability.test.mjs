import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const stripImports = source =>
  source
    .replace(/import[\s\S]*?from\s*["'][^"']+["'];?\s*/g, '')
    .replace(/export\s+(const|function)\s+/g, '$1 ');

test('TodayMain shiftDate does not rely on UTC-parsed new Date(dateStr)', () => {
  const source = fs.readFileSync('src/components/today/TodayMain.jsx', 'utf8');
  // new Date(dateStr) parses YYYY-MM-DD as UTC midnight, which shifts backward in UTC- timezones.
  assert.doesNotMatch(source, /new Date\(\s*dateStr\s*\)/, 'shiftDate must not parse YYYY-MM-DD with new Date(dateStr)');
});

test('deleteHabit and deleteGoal chunk writeBatch commits to <= 400 operations per batch', async () => {
  for (const [file, method, id] of [
    ['habits/habitService.js', 'deleteHabit', 'habit-1'],
    ['goals/goalService.js', 'deleteGoal', 'goal-1'],
  ]) {
    const batchSizes = [];
    const deletedRefs = [];
    const childDocs = Array.from({ length: 550 }, (_, index) => ({ ref: { kind: 'child', index } }));
    const context = vm.createContext({
      db: {},
      collection: (_db, name) => name,
      doc: (_db, name, key) => ({ kind: 'parent', name, key }),
      where: (field, op, value) => ({ field, op, value }),
      query: (name, ...filters) => ({ name, filters }),
      getDocs: async () => ({ forEach: fn => childDocs.forEach(fn) }),
      writeBatch: () => {
        const ops = [];
        return {
          delete: ref => ops.push(ref),
          commit: async () => {
            if (ops.length > 500) throw new Error(`Firestore batch limit exceeded: ${ops.length}`);
            batchSizes.push(ops.length);
            deletedRefs.push(...ops);
          },
        };
      },
    });
    vm.runInContext(`${stripImports(fs.readFileSync(`src/features/${file}`, 'utf8'))}\nglobalThis.remove = ${method};`, context);
    await context.remove('alice', id);
    assert.equal(deletedRefs.length, 551, `${method} must delete all 550 child docs + 1 parent doc`);
    assert.ok(batchSizes.length >= 2, `${method} must split 551 deletes across multiple batches`);
    assert.ok(batchSizes.every(size => size <= 400), `${method} batch sizes must be <= 400, got ${batchSizes}`);
    assert.equal(deletedRefs.at(-1).kind, 'parent', `${method} should delete parent doc last`);
  }
});

test('useTonkatsu clears previous error state when a valid snapshot arrives', () => {
  let state;
  let effectCleanup;
  let subscribeCallbacks;
  const context = vm.createContext({
    useState: init => {
      if (state === undefined) state = typeof init === 'function' ? init() : init;
      return [state, updater => { state = typeof updater === 'function' ? updater(state) : updater; }];
    },
    useEffect: fn => { effectCleanup?.(); effectCleanup = fn(); },
    useMemo: fn => fn(),
    baseDate: () => '2026-11-28',
    buildViews: () => ({}),
    subscribeTonkatsu: (_discordId, onData, onError) => {
      subscribeCallbacks = { onData, onError };
      return () => {};
    },
  });
  const source = stripImports(fs.readFileSync('src/features/tonkatsu/useTonkatsu.js', 'utf8'))
    .replace(/const today = useBaseDate\(\);/, "const today = '2026-11-28';");
  vm.runInContext(`${source}\nglobalThis.runHook = useTonkatsu;`, context);

  context.runHook('discord-1', true);
  subscribeCallbacks.onError(new Error('temporary network error'));
  assert.ok(context.runHook('discord-1', true).error, 'error should be recorded after onError');

  subscribeCallbacks.onData('members', [{ id: 'm1' }]);
  assert.equal(context.runHook('discord-1', true).error, null, 'error should clear when normal snapshot arrives');
});

test('useLearning only updates state when plannerDate actually changes', () => {
  let nowState;
  let nowUpdates = 0;
  let intervalFn;
  let focusFn;
  const listeners = new Map();
  let currentTime = new Date(2026, 10, 28, 10, 0, 0);

  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [currentTime.getTime()]));
    }
    static now() { return currentTime.getTime(); }
  }

  let stateIndex = 0;
  const states = [];
  const context = vm.createContext({
    Date: FakeDate,
    Object,
    setInterval: fn => { intervalFn = fn; return 1; },
    clearInterval: () => {},
    window: {
      addEventListener: (name, fn) => { listeners.set(name, fn); if (name === 'focus') focusFn = fn; },
      removeEventListener: name => listeners.delete(name),
    },
    useState: init => {
      const idx = stateIndex++;
      if (!(idx in states)) states[idx] = typeof init === 'function' ? init() : init;
      return [
        states[idx],
        updater => {
          const prev = states[idx];
          const next = typeof updater === 'function' ? updater(prev) : updater;
          if (idx === 1 && !Object.is(prev, next)) nowUpdates += 1;
          states[idx] = next;
          if (idx === 1) nowState = next;
        },
      ];
    },
    useEffect: (fn, deps) => {
      if (deps && deps.length === 1 && deps[0] === 'alice') fn();
    },
    useMemo: fn => fn(),
    useCollection: () => [[], true, null],
    plannerDate: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    learningStats: () => ({ streak: 0, days: {}, today: '2026-11-28' }),
    dateShift: d => d,
    goalEffectiveDate: () => '2026-11-28',
    recentDates: () => ['2026-11-28'],
    streakReachesDate: () => false,
    SUMMARY_DAYS: 30,
    validActivityTargets: () => true,
    validGoal: () => true,
    withRecentGoal: h => h,
    subscribeActivities: () => () => {},
    subscribeAllBlocks: () => () => {},
    isStudyBlock: () => true,
    archivedActivityReferences: () => [],
    missingActivitySnapshot: () => ({}),
    db: {},
    collection: () => {},
    query: () => {},
    where: () => {},
    onSnapshot: () => () => {},
    addDoc: () => {},
    deleteDoc: () => {},
    doc: () => {},
    serverTimestamp: () => {},
    updateDoc: () => {},
    writeBatch: () => {},
  });

  vm.runInContext(`${stripImports(fs.readFileSync('src/features/learning/useLearning.js', 'utf8'))}\nglobalThis.useLearning = useLearning;`, context);
  stateIndex = 0;
  context.useLearning('alice');

  // Same plannerDate (10:00 -> 10:30): interval and focus must not change state reference
  nowUpdates = 0;
  currentTime = new Date(2026, 10, 28, 10, 30, 0);
  intervalFn();
  focusFn();
  assert.equal(nowUpdates, 0, 'same plannerDate must not trigger state updates on interval/focus');

  // Next plannerDate (next day): must update state
  currentTime = new Date(2026, 10, 29, 10, 0, 0);
  intervalFn();
  assert.equal(nowUpdates, 1, 'changed plannerDate must trigger state update');
  assert.equal(nowState.getDate(), 29);
});

test('ScheduleSettings guards showModal() and closes dialog on cleanup', () => {
  const source = fs.readFileSync('src/components/ScheduleSettings.jsx', 'utf8');
  assert.match(source, /if\s*\(\s*![\w.]+\.open\s*\)\s*[\w.]+\.showModal\(\)/, 'ScheduleSettings must check !dialog.open before showModal()');
  assert.match(source, /return\s*\(\)\s*=>\s*\{?[\s\S]*?\.close\(\)/, 'ScheduleSettings must close dialog in useEffect cleanup');
});
