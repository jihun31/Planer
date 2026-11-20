const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadWindowState, saveWindowState, trackWindowState } = require('../electron/window-state.cjs');

const options = { workAreas: [{ x: 0, y: 0, width: 1920, height: 1040 }], minWidth: 800, minHeight: 600 };
const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'planer-window-')), 'nested', 'window-state.json');

function fakeWindow(bounds, maximized = false) {
  const events = new Map();
  return {
    events, destroyed: false,
    on: (name, cb) => events.set(name, cb),
    isDestroyed() { return this.destroyed; },
    getNormalBounds: () => bounds,
    isMaximized: () => maximized,
  };
}

test('window state falls back to the default size when nothing is saved or the file is broken', () => {
  const file = tempFile();
  assert.deepEqual(loadWindowState(file, options), { bounds: { width: 1280, height: 800 }, maximized: false });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(loadWindowState(file, options), { bounds: { width: 1280, height: 800 }, maximized: false });
  fs.writeFileSync(file, JSON.stringify({ bounds: { x: 0, y: 0, width: 300, height: 200 }, maximized: true }));
  assert.deepEqual(loadWindowState(file, options), { bounds: { width: 1280, height: 800 }, maximized: true });
});

test('window state round-trips size, position and maximized state', () => {
  const file = tempFile();
  saveWindowState(file, fakeWindow({ x: 120, y: 80, width: 1400, height: 900 }, true));
  assert.deepEqual(loadWindowState(file, options), { bounds: { x: 120, y: 80, width: 1400, height: 900 }, maximized: true });
});

test('window state keeps the size but drops a position on a monitor that is gone', () => {
  const file = tempFile();
  saveWindowState(file, fakeWindow({ x: 2500, y: 100, width: 1200, height: 800 }));
  assert.deepEqual(loadWindowState(file, options), { bounds: { width: 1200, height: 800 }, maximized: false });
  const twoMonitors = { ...options, workAreas: [...options.workAreas, { x: 1920, y: 0, width: 2560, height: 1400 }] };
  assert.deepEqual(loadWindowState(file, twoMonitors).bounds, { x: 2500, y: 100, width: 1200, height: 800 });
});

test('window state is saved on close and shortly after moving', async () => {
  const file = tempFile();
  const win = fakeWindow({ x: 10, y: 20, width: 1000, height: 700 });
  trackWindowState(win, file, 5);
  win.events.get('move')();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).bounds, { x: 10, y: 20, width: 1000, height: 700 });
  fs.rmSync(file);
  win.events.get('close')();
  assert.equal(fs.existsSync(file), true);
  win.destroyed = true;
  fs.rmSync(file);
  saveWindowState(file, win);
  assert.equal(fs.existsSync(file), false);
});
