import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import preview from '../electron/link-preview.cjs';
import { selectTests } from '../scripts/affected-tests.mjs';
import { hasRunningSetup } from '../scripts/install-local.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('link-preview blocks IPv6 6to4, Teredo, leading-zero documentation, and reserved ranges', async () => {
  const blocked = [
    '2002:7f00:0001::1',
    '2001:0000:4136:e378:8000:63bf:3fff:fdd2',
    '2001::1',
    '2001:0db8::1',
    '2001:0DB8:85a3::8a2e:0370:7334',
    '2::1',
    '3fff::1',
    '::ffff:127.0.0.1',
  ];
  for (const ip of blocked) {
    assert.equal(preview.publicAddress(ip), false, `publicAddress should reject ${ip}`);
    await assert.rejects(
      preview.loadLinkPreview(`http://[${ip}]/`, async () => ({ html: '<title>Leaked</title>' })),
      /Invalid website URL/,
      `loadLinkPreview should block ${ip}`,
    );
  }
  assert.equal(preview.publicAddress('2606:4700:4700::1111'), true);
  assert.equal(preview.publicAddress('2001:4860:4860::8888'), true);
  const ok = await preview.loadLinkPreview('https://[2606:4700:4700::1111]/', async () => ({
    html: '<title>Public IPv6</title>',
  }));
  assert.equal(ok.title, 'Public IPv6');
});

test('link-preview blocks https to http redirect downgrade while allowing upgrades', async () => {
  let calls = 0;
  await assert.rejects(
    preview.loadLinkPreview('https://example.com/start', async () => {
      calls++;
      return { location: 'http://example.com/insecure' };
    }),
    /downgrade/i,
  );
  assert.equal(calls, 1);

  const visited = [];
  const upgraded = await preview.loadLinkPreview('http://example.com/start', async (url) => {
    visited.push(url.href);
    return visited.length === 1
      ? { location: 'https://example.com/secure' }
      : { html: '<title>Upgraded</title>' };
  });
  assert.deepEqual(visited, ['http://example.com/start', 'https://example.com/secure']);
  assert.equal(upgraded.title, 'Upgraded');
});

test('affected-tests reports uncovered src, electron, and scripts files', () => {
  const calendarPath = ['src', 'components', 'tabs', 'CalendarTab.jsx'].join('/');
  const calendar = selectTests([calendarPath]);
  assert.deepEqual(calendar.uncovered, [calendarPath]);
  assert.deepEqual(calendar.selected, []);

  const runDevPath = ['electron', 'run-dev.cjs'].join('/');
  const runDev = selectTests([runDevPath]);
  assert.deepEqual(runDev.uncovered, [runDevPath]);
  assert.deepEqual(runDev.selected, []);

  const fakeScript = selectTests(['scripts/uncovered-example.mjs']);
  assert.deepEqual(fakeScript.uncovered, ['scripts/uncovered-example.mjs']);
});

test('install-local setupRunning regex matches Planner-Setup and Planer-Setup executables', () => {
  assert.equal(hasRunningSetup('"Planner-Setup-1.2.100.exe","1234","Console","1","12,000 K"'), true);
  assert.equal(hasRunningSetup('"Planer-Setup-1.2.100.exe","1234","Console","1","12,000 K"'), true);
  assert.equal(hasRunningSetup('"Planer.exe","1234","Console","1","12,000 K"'), false);
  assert.equal(hasRunningSetup('"Other-Setup-1.0.0.exe","1234","Console","1","12,000 K"'), false);
});

test('electron/main.js hardens window restore, dev update IPC, shutdown cleanup, permissions, and single instance', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  const restoreMatches = main.match(/mainWindow\.restore\(\)/g) || [];
  assert.equal(restoreMatches.length, 1, 'only revealMain() should call mainWindow.restore()');
  assert.match(main, /ipcMain\.handle\('update:get-state'/);
  assert.match(main, /stopAutoUpdate/);
  assert.match(main, /before-quit[\s\S]*stopAutoUpdate\(\)/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /setPermissionCheckHandler/);
});

test('index.html CSP includes form-action none and package.json declares @electron/asar', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /form-action 'none'/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.devDependencies?.['@electron/asar'], '@electron/asar must be in devDependencies');
  assert.equal(pkg.devDependencies?.['@types/react'], undefined);
  assert.equal(pkg.devDependencies?.['@types/react-dom'], undefined);
});

test('timer-popup uses dedicated minimal preload, strict CSP, and external script', () => {
  const listeners = new Map();
  const sent = [];
  let api = null;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'electron/timer-popup-preload.cjs'), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_key, value) => { api = value; } },
      ipcRenderer: {
        on: (channel, cb) => listeners.set(channel, cb),
        removeListener: (channel, cb) => { if (listeners.get(channel) === cb) listeners.delete(channel); },
        send: (channel, ...args) => sent.push({ channel, args }),
      },
    }),
  });
  assert.deepEqual(Object.keys(api).sort(), ['onTimerData', 'sendRestPopupCommand', 'stopTimerFromPopup']);
  let received = null;
  const cleanup = api.onTimerData((data) => { received = data; });
  listeners.get('timer:data')({ sender: 'privileged' }, { actName: 'Study' });
  assert.deepEqual(received, { actName: 'Study' });
  cleanup();
  assert.equal(listeners.size, 0);
  api.stopTimerFromPopup();
  api.sendRestPopupCommand({ type: 'end', key: '1:2' });
  assert.deepEqual(sent, [
    { channel: 'timer:stop-from-popup', args: [] },
    { channel: 'rest:popup-command', args: [{ type: 'end', key: '1:2' }] },
  ]);

  const popupHtml = fs.readFileSync(path.join(root, 'electron/timer-popup.html'), 'utf8');
  assert.match(
    popupHtml,
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';"/,
  );
  assert.match(popupHtml, /<script\s+src="\.\/timer-popup\.js"><\/script>/);
  assert.doesNotMatch(popupHtml, /<script(?:\s[^>]*)?>[\s\S]*?\S[\s\S]*?<\/script>/);

  const popupJs = fs.readFileSync(path.join(root, 'electron/timer-popup.js'), 'utf8');
  const usedApis = new Set([...popupJs.matchAll(/window\.electronAPI\.(\w+)/g)].map((m) => m[1]));
  assert.deepEqual([...usedApis].sort(), ['onTimerData', 'sendRestPopupCommand', 'stopTimerFromPopup']);

  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  assert.match(main, /preload:\s*path\.join\(__dirname,\s*'timer-popup-preload\.cjs'\)/);
});

test('check-version.mjs applies AbortSignal.timeout(10000) to all GitHub fetch calls', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/check-version.mjs'), 'utf8');
  const fetchCalls = source.match(/\bfetch\(/g) || [];
  const timeoutMatches = source.match(/signal:\s*AbortSignal\.timeout\(10000\)/g) || [];
  assert.ok(fetchCalls.length >= 2, 'expected at least 2 fetch calls in check-version.mjs');
  assert.equal(timeoutMatches.length, fetchCalls.length, 'every fetch call must pass signal: AbortSignal.timeout(10000)');
});
