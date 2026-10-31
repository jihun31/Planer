const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { setupAutoUpdate, CHECK_DELAY_MS, CHECK_INTERVAL_MS } = require('../electron/auto-update.cjs');

function harness({ allowed = true } = {}) {
  const updater = Object.assign(new EventEmitter(), {
    checks: 0, installs: [],
    checkForUpdates() { this.checks++; return Promise.resolve(); },
    quitAndInstall(...args) { this.installs.push(args); },
  });
  const handlers = {}, listeners = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { listeners[ch] = fn; } };
  const sent = [];
  const win = { isDestroyed: () => false, webContents: { send: (ch, data) => sent.push([ch, data]) } };
  const timers = { timeouts: [], intervals: [],
    setTimeout(fn, ms) { this.timeouts.push([fn, ms]); return 1; }, setInterval(fn, ms) { this.intervals.push([fn, ms]); return 2; },
    clearTimeout() {}, clearInterval() {} };
  const warnings = [];
  const api = setupAutoUpdate({ autoUpdater: updater, ipcMain, isAllowed: () => allowed, getWindow: () => win,
    logger: { warn: (...a) => warnings.push(a) }, timers });
  return { updater, handlers, listeners, sent, timers, warnings, api };
}

test('checks shortly after start and then every 4 hours, downloading automatically', () => {
  const h = harness();
  assert.equal(h.updater.autoDownload, true);
  assert.equal(h.updater.autoInstallOnAppQuit, true);
  assert.deepEqual(h.timers.timeouts.map(([, ms]) => ms), [CHECK_DELAY_MS]);
  assert.deepEqual(h.timers.intervals.map(([, ms]) => ms), [CHECK_INTERVAL_MS]);
  assert.equal(CHECK_INTERVAL_MS, 4 * 3600e3);
  h.timers.timeouts[0][0](); h.timers.intervals[0][0]();
  assert.equal(h.updater.checks, 2);
});

test('reports progress to the window and installs only when ready', async () => {
  const h = harness();
  h.listeners['update:install']({}); // 아직 준비 안 됨
  assert.equal(h.updater.installs.length, 0);
  h.updater.emit('checking-for-update');
  h.updater.emit('update-available', { version: '1.1.9' });
  h.updater.emit('download-progress', { percent: 41.6 });
  h.updater.emit('update-downloaded', { version: '1.1.9' });
  assert.deepEqual(h.sent.map(([, s]) => s.status), ['checking', 'downloading', 'downloading', 'ready']);
  assert.equal(h.sent[2][1].percent, 42);
  assert.equal(h.sent.every(([ch]) => ch === 'update:status'), true);
  assert.deepEqual(await h.handlers['update:get-state']({}), { status: 'ready', version: '1.1.9' });
  // 다 받은 뒤 다시 확인하거나 오류가 나도 '준비됨'은 유지
  h.updater.emit('checking-for-update'); h.updater.emit('error', new Error('offline'));
  assert.equal(h.api.getState().status, 'ready');
  h.listeners['update:install']({});
  assert.deepEqual(h.updater.installs, [[true, true]]); // 조용히 설치 후 다시 실행
});

test('ignores requests from other windows and stays quiet on network errors', async () => {
  const h = harness({ allowed: false });
  h.updater.emit('update-downloaded', { version: '1.1.9' });
  assert.equal(await h.handlers['update:get-state']({}), null);
  h.listeners['update:install']({});
  assert.equal(h.updater.installs.length, 0);
  const e = harness();
  e.updater.emit('error', new Error('getaddrinfo ENOTFOUND github.com'));
  assert.equal(e.api.getState().status, 'error');
  assert.equal(e.warnings.length, 1);
});

test('build and release settings publish what the updater reads', () => {
  const root = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies['electron-updater'], 'electron-updater must ship with the app');
  assert.deepEqual(pkg.build.publish, [{ provider: 'github', owner: 'jihun31', repo: 'Planer' }]);
  assert.equal(pkg.build.nsis.artifactName, 'Planer-Setup-${version}.${ext}'); // 공백 없는 이름 = latest.yml과 일치
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /npm version "1\.1\.\$env:GITHUB_RUN_NUMBER"/);
  // 병합 때 자동 배포: main push + 앱 파일 경로, 봇만 바뀌면 실행 안 함, 직접 실행도 가능
  assert.match(workflow, /push:\s+branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  for (const p of ["'src/**'", "'electron/**'", "'package.json'"]) assert.ok(workflow.includes(p), p);
  assert.ok(!workflow.includes("'bot/**'"));
  assert.match(workflow, /cancel-in-progress: false/);
  for (const name of ['latest.yml', 'Planer-Setup-$version.exe.blockmap', 'Planer-Setup-$version.exe'])
    assert.ok(workflow.includes(name), name);
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  assert.match(main, /if \(!isDev\)[\s\S]*setupAutoUpdate/);
});
