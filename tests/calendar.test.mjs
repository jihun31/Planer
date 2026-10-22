import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  calendarToday, monthGrid, shiftCalendarMonth, isCalendarDate, eventInput,
} from '../src/features/calendar/calendarDates.mjs';
import { subscribeDateGroups } from '../src/features/planner/blockSubscriptions.mjs';

test('calendar dates change at midnight and reject invalid or overflowing dates', () => {
  assert.equal(calendarToday(new Date(2026, 9, 22, 2)), '2026-10-22');
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-00', 'invalid', '0026-01-01']) {
    assert.equal(isCalendarDate(date), false, date);
  }
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.equal(shiftCalendarMonth('2026-01-31', 1), '2026-02-28');
  assert.equal(shiftCalendarMonth('2028-01-31', 1), '2028-02-29');
  assert.equal(shiftCalendarMonth('2026-01-31', -1), '2025-12-31');
});

test('calendar grid covers whole weeks, including adjacent months and leap days', () => {
  const dates = monthGrid('2026-10');
  assert.equal(dates.length, 35);
  assert.equal(dates[0], '2026-09-27');
  assert.equal(dates.at(-1), '2026-10-31');
  assert.equal(monthGrid('2026-08').length, 42);
  assert.ok(monthGrid('2028-02').includes('2028-02-29'));
  assert.equal(new Set(dates).size, dates.length);
});

test('event input accepts a single date, trims content and rejects invalid or excessive input', () => {
  const input = { title: '  병원 방문  ', date: '2026-10-22', note: ' 메모 ', color: '#6366f1' };
  assert.deepEqual(eventInput(input), { ...input, title: '병원 방문', note: '메모' });
  for (const invalid of [{ title: ' ' }, { title: 'x'.repeat(121) }, { note: 'x'.repeat(5001) }, { date: '2026-02-29' }, { color: 'red' }]) {
    assert.throws(() => eventInput({ ...input, ...invalid }));
  }
});

function serviceHarness({ rejectCommit = false } = {}) {
  const commits = [], writes = [], queries = [], watchers = [];
  let serial = 0;
  const context = vm.createContext({
    db: {}, eventInput, subscribeDateGroups,
    collection: (_db, name) => name,
    doc: (db, name, id) => id ? { name, id } : { name: db, id: `generated-${++serial}` },
    serverTimestamp: () => 'server-time',
    writeBatch: () => {
      const pending = [];
      return {
        set: (ref, data) => pending.push({ ref, data }),
        commit: async () => {
          commits.push(pending);
          if (rejectCommit) throw new Error('permission-denied');
          writes.push(...pending);
        },
      };
    },
    updateDoc: async (ref, data) => writes.push({ ref, data }),
    deleteDoc: async ref => writes.push({ ref, deleted: true }),
    where: (field, op, value) => ({ field, op, value }),
    query: (name, ...filters) => ({ name, filters }),
    onSnapshot: (query, receive, fail) => {
      queries.push(query);
      const watcher = { receive, fail, stopped: false };
      watchers.push(watcher);
      return () => { watcher.stopped = true; };
    },
  });
  const source = fs.readFileSync('src/features/calendar/calendarService.js', 'utf8')
    .replace(/import[\s\S]*?from\s*['"][^'"]+['"];?/g, '').replace(/export /g, '');
  vm.runInContext(source + '\nglobalThis.service = {addCalendarEvent, updateCalendarEvent, deleteCalendarEvent, subscribeCalendarEvents};', context);
  return { service: context.service, commits, writes, queries, watchers };
}

const input = { title: '병원 방문', date: '2026-10-22', note: '', color: '#6366f1' };

test('task opt-in creates one todo with the event date as its deadline in a single atomic commit', async () => {
  const { service, commits, writes } = serviceHarness();
  await service.addCalendarEvent('alice', input, true);
  assert.equal(commits.length, 1);
  assert.equal(writes.length, 2);
  const [event, task] = writes;
  assert.equal(event.ref.name, 'calendarEvents');
  assert.equal(task.ref.name, 'todos');
  assert.equal(event.data.uid, 'alice');
  assert.equal(task.data.uid, 'alice');
  assert.equal(event.data.taskId, task.ref.id);
  assert.equal(task.data.calendarEventId, event.ref.id);
  assert.equal(task.data.title, input.title);
  assert.equal(task.data.dueDate, input.date);
  assert.equal('timeSlot' in task.data, false);
  assert.equal(task.data.completed, false);
});

test('without opt-in only an event is created; invalid input and logged-out saves do not write', async () => {
  const { service, commits, writes } = serviceHarness();
  await service.addCalendarEvent('alice', input);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.taskId, null);
  await assert.rejects(service.addCalendarEvent(null, input));
  await assert.rejects(service.addCalendarEvent('alice', { ...input, title: '' }));
  assert.equal(commits.length, 1);
});

test('a failed combined commit rejects the save without leaving a partial event', async () => {
  const { service, writes } = serviceHarness({ rejectCommit: true });
  await assert.rejects(service.addCalendarEvent('alice', input, true));
  assert.equal(writes.length, 0);
});

test('editing and deleting a calendar event never alters or recreates its task', async () => {
  const { service, writes } = serviceHarness();
  await service.updateCalendarEvent('event', { ...input, title: '새 제목', date: '2026-11-01' });
  await service.deleteCalendarEvent('event');
  assert.equal(writes.length, 2);
  assert.ok(writes.every(item => item.ref.name === 'calendarEvents'));
  assert.equal(writes[0].data.date, '2026-11-01');
  assert.equal(writes[0].data.title, '새 제목');
});

test('visible date queries are owner-scoped, within query limits, merged after loading, and cleaned up', () => {
  const { service, queries, watchers } = serviceHarness();
  const deliveries = [];
  const stop = service.subscribeCalendarEvents('alice', monthGrid('2026-08'), rows => deliveries.push(rows), assert.fail);
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.ok(query.filters.some(filter => filter.field === 'uid' && filter.value === 'alice'));
    assert.ok(query.filters.find(filter => filter.field === 'date').value.length <= 30);
  }
  const snapshot = (id, date) => ({ docs: [{ id, data: () => ({ uid: 'alice', date }) }] });
  watchers[0].receive(snapshot('a', '2026-08-01'));
  assert.equal(deliveries.length, 0);
  watchers[1].receive(snapshot('b', '2026-09-01'));
  assert.equal(deliveries[0].length, 2);
  stop();
  assert.ok(watchers.every(watcher => watcher.stopped));
  watchers[0].receive(snapshot('late', '2026-08-02'));
  assert.equal(deliveries.length, 1);
});
