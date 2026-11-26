import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const strip = source => source.replace(/import[\s\S]*?from\s*["'][^"']+["'];/g, '').replace(/export (const|function) /g, '$1 ');
test('all cascading deletion queries include authenticated owner', async () => {
  for (const [file, method, id] of [
    ['goals/goalService.js', 'deleteGoal', 'goal'],
    ['habits/habitService.js', 'deleteHabit', 'habit'],
  ]) {
    const queries = [];
    const context = vm.createContext({
      db: {}, collection: (_db, name) => name, doc: (_db, name, key) => ({ name, key }),
      where: (field, op, value) => ({ field, op, value }),
      query: (name, ...filters) => ({ name, filters }),
      getDocs: async q => { queries.push(q); return { forEach() {} }; },
      writeBatch: () => ({ delete() {}, commit: async () => {} }),
    });
    vm.runInContext(strip(fs.readFileSync('src/features/' + file, 'utf8')) + '\nglobalThis.remove = ' + method, context);
    await context.remove('alice', id);
    assert.equal(queries.length, 1);
    assert.ok(queries[0].filters.some(f => f.field === 'uid' && f.op === '==' && f.value === 'alice'));
  }
});
test('collection hook clears previous account immediately and ignores late callbacks', async () => {
  let state, dependencies, cleanup, cursor = false;
  const same = (a,b) => a && a.every((v,i) => v === b[i]);
  const context = vm.createContext({
    queueMicrotask,
    useState: () => [state, value => { state = value; }],
    useEffect: (fn, deps) => {
      if (!cursor || !same(dependencies, deps)) { cleanup?.(); cleanup = fn(); dependencies = deps; cursor = true; }
    },
  });
  vm.runInContext(strip(fs.readFileSync('src/lib/useCollection.js','utf8')) + '\nglobalThis.hook = useCollection;', context);
  const watchers = [];
  const subscribe = (uid, cb, error) => {
    const w = { uid, cb, error, stopped: false }; watchers.push(w);
    return () => { w.stopped = true; };
  };
  const flush = () => new Promise(resolve => queueMicrotask(resolve));
  context.hook('alice', subscribe); await flush();
  watchers[0].cb([{ id: 'alice-private' }]);
  assert.equal(context.hook('alice', subscribe)[0][0].id, 'alice-private');
  assert.equal(context.hook('bob', subscribe)[0].length, 0);
  assert.ok(watchers[0].stopped);
  watchers[0].cb([{ id: 'late-private' }]);
  await flush();
  assert.equal(context.hook('bob', subscribe)[0].length, 0);
  watchers[1].cb([{ id: 'bob-own' }]);
  assert.equal(context.hook('bob', subscribe)[0][0].id, 'bob-own');
  assert.equal(context.hook(null, subscribe)[0].length, 0);
  assert.ok(watchers[1].stopped);
});
test('preload subscriptions return cleanup and never pass raw Electron events', () => {
  const listeners = new Map();
  let api;
  let started;
  vm.runInNewContext(fs.readFileSync('electron/preload.cjs','utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_key, value) => { api = value; } },
      ipcRenderer: {
        invoke: (name, data, ...rest) => { started = { name, data, ...(rest.length ? { rest } : {}) }; return Promise.resolve({ ok: true }); },
        on: (name, callback) => listeners.set(name, callback),
        removeListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
      },
    }),
  });
  let received;
  const remove = api.onTimerStopped(data => { received = data; });
  listeners.get('timer:stopped')({ sender: 'privileged' }, 'safe');
  assert.equal(received, 'safe');
  remove(); assert.equal(listeners.size, 0);
  return api.startTimerPopup({ actName: 'Study' }).then(result => {
    assert.deepEqual(started, { name: 'timer:start', data: { actName: 'Study' } });
    assert.equal(result.ok, true);
    return api.openTimerPopup({ actName: 'Study' });
  }).then(() => {
    assert.deepEqual(JSON.parse(JSON.stringify(started)), { name: 'timer:start', data: { actName: 'Study' }, rest: [{ minimize: false }] });
  });
});

test('Electron IPC rejects other windows and child frames; stop is delivered once from timer window', async () => {
  const handlers = new Map(), invokes = new Map(), windows = [], appEvents = new Map();
  let instanceLockRequests = 0;
  const displays = [
    { workArea: { x: 0, y: 0, width: 1000, height: 800 } },
    { workArea: { x: 1000, y: 0, width: 1200, height: 900 } },
  ];
  const titleRequests = [];
  let noteImagesAllowed = null;
  class FakeWindow {
    constructor({ width, height }) {
      this.events = new Map(); this.dead = false; this.sent = [];
      this.size = [width, height];
      this.webContents = {
        mainFrame: { url: '' },
        on() {}, once() {}, setWindowOpenHandler() {},
        send: (name, data) => this.sent.push({ name, data }),
      };
      windows.push(this);
    }
    on(name, cb) { this.events.set(name, cb); }
    once(name, cb) { this.events.set(name, cb); }
    loadURL(url) { this.webContents.mainFrame.url = url; }
    getSize() { return this.size; }
    setSize(w, h) { this.size = [w, h]; }
    setResizable() {}
    isDestroyed() { return this.dead; }
    close() { this.events.get('close')?.(); this.dead = true; this.events.get('closed')?.(); }
    destroy() { this.dead = true; this.events.get('closed')?.(); }
    focus() {} restore() {} show() {} maximize() {} minimize() { this.minimized = true; } setPosition(x,y) { this.position = [x,y]; }
    getNormalBounds() { return this.bounds || { x: 0, y: 0, width: 1280, height: 800 }; }
  }
  const pathModule = await import('node:path');
  const urlModule = await import('node:url');
  const { default: restReminder } = await import('../electron/rest-reminder.cjs');
  const context = {
    __dirname: pathModule.resolve('electron'),
    require(name) {
      if (name === 'electron') return {
        app: { isPackaged: false, whenReady: () => ({ then: fn => fn() }), on: (key, cb) => appEvents.set(key, cb), setAppUserModelId() {},
          requestSingleInstanceLock: () => { instanceLockRequests++; return true; }, quit() { throw Error('Should keep the instance'); } },
        BrowserWindow: FakeWindow,
        shell: { openExternal: () => Promise.resolve() },
        ipcMain: { on: (key, cb) => handlers.set(key, cb), handle: (key, cb) => invokes.set(key, cb) },
        powerMonitor: { on() {} },
        screen: {
          getPrimaryDisplay: () => displays[0],
          getAllDisplays: () => displays,
          getDisplayMatching: rect => displays.find(({ workArea: a }) => rect.x >= a.x && rect.x < a.x + a.width) || displays[0],
        },
      };
      if (name === 'node:path') return pathModule;
      if (name === 'node:url') return urlModule;
      if (name === 'node:fs') return { readFileSync() { throw Error('No OAuth config'); } };
      if (name === './google-auth.cjs') return {};
      if (name === './window-state.cjs') return { loadWindowState: () => ({ bounds: { width: 1280, height: 800 }, maximized: false }), trackWindowState() {} };
      if (name === './rest-reminder.cjs') return restReminder;
      if (name === './note-image-store.cjs') return { registerNoteImages: (_ipcMain, allowed) => { noteImagesAllowed = allowed; } };
      throw Error('Unexpected require ' + name);
    },
    URL, AbortSignal, encodeURIComponent, process: { platform: 'win32' },
    fetch:async (url,options) => {titleRequests.push({url,options});return {ok:true,json:async () => ({title:'공개 영상 제목',author_name:'영상 채널'})};},
  };
  vm.runInNewContext(fs.readFileSync('electron/main.js','utf8'), context);
  const main = windows[0];
  const eventFor = win => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
  const maliciousFrame = { sender: main.webContents, senderFrame: { url: main.webContents.mainFrame.url } };
  assert.equal((await invokes.get('auth:google')(maliciousFrame)).code, 'desktop/forbidden');
  assert.equal((await invokes.get('notes:youtube-title')(maliciousFrame,'jNQXAC9IVRw')).code,'desktop/forbidden');
  assert.equal((await invokes.get('notes:link-preview')(maliciousFrame,'https://example.com')).code,'desktop/forbidden');
  assert.equal((await invokes.get('notes:youtube-title')(eventFor(main),'https://evil.example')).ok,false);
  assert.equal(titleRequests.length,0);
  assert.equal((await invokes.get('notes:youtube-title')(eventFor(main),'jNQXAC9IVRw')).title,'공개 영상 제목');
  assert.equal((await invokes.get('notes:youtube-title')(eventFor(main),'jNQXAC9IVRw')).author,'영상 채널');
  assert.equal(new URL(titleRequests[0].url).origin,'https://www.youtube.com');
  assert.equal(titleRequests[0].options.redirect,'error');
  assert.equal((await invokes.get('auth:google')(eventFor(main))).code, 'desktop/config-missing');
  const data = { actName: 'Study', color: '#6366f1', startTs: 100, startLabel: '08:00' };
  assert.equal(instanceLockRequests, 1);
  assert.equal(handlers.has('timer:open'), false, 'timer:start is the only way to open the timer popup');
  assert.equal((await invokes.get('timer:start')(maliciousFrame, data)).code, 'desktop/forbidden');
  assert.equal(windows.length, 1);
  main.webContents.mainFrame.url += '?vite=refresh';
  assert.equal((await invokes.get('timer:start')(eventFor(main), data)).ok, true);
  assert.equal(windows.length, 2);
  assert.equal(main.minimized, true);
  main.webContents.mainFrame.url = 'http://localhost:5173/other';
  assert.equal((await invokes.get('timer:start')(eventFor(main), data)).code, 'desktop/forbidden');
  main.webContents.mainFrame.url = 'http://localhost:5173/';
  const timer = windows[1];
  assert.deepEqual(timer.getSize(), [176, 128]);
  assert.deepEqual(timer.position, [796, 656]);
  assert.equal((await invokes.get('notes:youtube-title')(eventFor(timer),'jNQXAC9IVRw')).code,'desktop/forbidden');
  assert.equal((await invokes.get('auth:google')(eventFor(timer))).code, 'desktop/forbidden');
  assert.equal((await invokes.get('notes:link-preview')(eventFor(timer),'https://example.com')).code,'desktop/forbidden');
  // Note photos use the same main-window check as the other note IPC.
  assert.equal(noteImagesAllowed(eventFor(main)),true);
  assert.equal(noteImagesAllowed(eventFor(timer)),false);
  assert.equal(noteImagesAllowed(maliciousFrame),false);
  handlers.get('timer:stop-from-popup')(eventFor(main));
  assert.ok(!timer.dead);
  const timerEvent = eventFor(timer);
  handlers.get('timer:stop-from-popup')(timerEvent);
  handlers.get('timer:stop-from-popup')(timerEvent);
  assert.equal(main.sent.filter(x => x.name === 'timer:stopped').length, 1);
  assert.equal((await invokes.get('timer:start')(eventFor(main),{...data,position:'left'})).ok,true);
  assert.deepEqual(windows[2].position, [28, 656]);
  handlers.get('timer:close')(eventFor(main));
  // Compact mode uses 136x66 with a 16px margin from the screen corner.
  assert.equal((await invokes.get('timer:start')(eventFor(main),{...data,compact:true})).ok,true);
  assert.deepEqual(windows.at(-1).getSize(), [136, 66]);
  assert.deepEqual(windows.at(-1).position, [1000 - 136 - 16, 800 - 66 - 16]);
  handlers.get('timer:close')(eventFor(main));
  // Moving a running timer to the popup keeps the main window up.
  main.minimized = false;
  assert.equal((await invokes.get('timer:start')(eventFor(main), data, { minimize: false })).ok, true);
  assert.equal(main.minimized, false);
  windows.at(-1).destroy();
  // The popup follows the monitor the main window is on.
  main.bounds = { x: 1100, y: 50, width: 1280, height: 800 };
  assert.equal((await invokes.get('timer:start')(eventFor(main), data)).ok, true);
  assert.deepEqual(windows.at(-1).position, [1000 + 1200 - 176 - 28, 900 - 128 - 16]);
  handlers.get('timer:close')(eventFor(main));
  delete main.bounds;
  // A second launch brings the existing window forward instead of opening another app.
  assert.equal(typeof appEvents.get('second-instance'), 'function');
  const rest = { ...data, endTs: 60100 };
  assert.equal((await invokes.get('rest:open-popup')(maliciousFrame, rest)).ok, false);
  assert.equal((await invokes.get('rest:open-popup')(eventFor(main), rest)).ok, true);
  const restWindow = windows.at(-1);
  assert.deepEqual(restWindow.getSize(), [176, 112]);
  assert.deepEqual(restWindow.position, [804, 672]);
  handlers.get('timer:stop-from-popup')(eventFor(restWindow));
  assert.equal(restWindow.dead, false);
  handlers.get('rest:close-popup')(eventFor(main));
  assert.equal(restWindow.dead, true);

  const openRest = invokes.get('rest:open-popup');
  assert.equal((await openRest(eventFor(main), { ...data })).ok, false);
  assert.equal((await openRest(eventFor(main), { ...data, endTs: null })).ok, true);
  const unlimitedEvent = eventFor(windows.at(-1));
  const command = handlers.get('rest:popup-command');
  const key = data.startTs + ':null';
  const restCommands = () => main.sent.filter(message => message.name === 'rest:command');
  command(unlimitedEvent, { type: 'expire', key });
  assert.equal(restCommands().length, 0);
  command(unlimitedEvent, { type: 'end', key });
  assert.equal(restCommands().length, 1);
  assert.equal(restCommands()[0].data.type, 'end');
});
