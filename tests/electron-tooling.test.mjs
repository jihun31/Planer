import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
});
