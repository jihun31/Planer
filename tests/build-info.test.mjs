import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { EXCLUDED_PACKAGED_FILES, writeBuildInfo } from '../scripts/write-build-info.mjs';
import { verifyBuildInfo } from '../scripts/check-version.mjs';

const asar = createRequire(import.meta.url)('@electron/asar');

function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planer-build-info-'));
  const write = (file, text) => {fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});fs.writeFileSync(path.join(dir, file), text);};
  write('package.json', JSON.stringify({name: 'planer', version: '1.0.0'}));
  write('electron/main.js', 'console.log("main");\n');
  write('src/app.jsx', 'export default 1;\n');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], {cwd: dir, stdio: 'ignore'});
  git('init', '-q');fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n');git('add', '.');git('commit', '-q', '-m', 'app');
  write('dist/index.html', '<script src="assets/index.js"></script>');
  write('dist/assets/index.js', 'render();\n');
  return {dir, write, git};
}
const pack = async (dir, name) => {const file = path.join(dir, '..', path.basename(dir) + name);await asar.createPackage(dir, file);return file;};

test('an app packed right after the build passes, with its commit recorded', async () => {
  const {dir, git} = makeApp();
  try {
    const info = writeBuildInfo(dir);
    assert.deepEqual(Object.keys(info.files), ['dist/assets/index.js', 'dist/index.html', 'electron/main.js']);
    assert.deepEqual(info.uncommitted, []);
    assert.match(info.commit, /^[0-9a-f]{40}$/);
    const file = await pack(dir, '.asar');
    const result = verifyBuildInfo(file);
    assert.deepEqual(result.problems, []);
    assert.equal(result.info.commit, info.commit);
    fs.rmSync(file);
    // A release build only bumps the version in package.json, which is not an uncommitted change.
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name: 'planer', version: '1.1.0'}));
    assert.deepEqual(writeBuildInfo(dir).uncommitted, []);
    git('status');
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});

test('editing, adding or removing a packaged file after the build fails the check', async () => {
  const {dir, write} = makeApp();
  const files = [];
  try {
    writeBuildInfo(dir);
    write('dist/assets/index.js', 'render();patched();\n');
    files.push(await pack(dir, '-edited.asar'));
    assert.match(verifyBuildInfo(files.at(-1)).problems.join('\n'), /빌드한 뒤에 바뀐 파일: dist\/assets\/index\.js/);
    write('dist/assets/index.js', 'render();\n');write('electron/extra.cjs', '1');
    files.push(await pack(dir, '-extra.asar'));
    assert.match(verifyBuildInfo(files.at(-1)).problems.join('\n'), /빌드 정보에 없는 파일이 앱에 들어 있음: electron\/extra\.cjs/);
    fs.rmSync(path.join(dir, 'electron/extra.cjs'));fs.rmSync(path.join(dir, 'dist/index.html'));
    files.push(await pack(dir, '-missing.asar'));
    assert.match(verifyBuildInfo(files.at(-1)).problems.join('\n'), /앱에 없는 파일: dist\/index\.html/);
    fs.rmSync(path.join(dir, 'dist/build-info.json'));
    files.push(await pack(dir, '-old.asar'));
    assert.match(verifyBuildInfo(files.at(-1)).problems[0], /빌드 정보\(dist\/build-info\.json\)가 없습니다/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
    for (const file of files) fs.rmSync(file, {force: true});
  }
});

test('a build made from uncommitted source changes is reported', async () => {
  const {dir, write} = makeApp();
  let file;
  try {
    write('src/app.jsx', 'export default 2;\n');
    const info = writeBuildInfo(dir);
    assert.deepEqual(info.uncommitted, ['src/app.jsx']);
    file = await pack(dir, '.asar');
    assert.match(verifyBuildInfo(file).problems.join('\n'), /커밋 안 된 변경으로 빌드했습니다: src\/app\.jsx/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
    if (file) fs.rmSync(file, {force: true});
  }
});

test('dev-only electron files are excluded from build-info and package.json build.files', () => {
  const { dir, write } = makeApp();
  try {
    for (const excluded of EXCLUDED_PACKAGED_FILES) write(excluded, 'dev-only\n');
    const info = writeBuildInfo(dir);
    for (const excluded of EXCLUDED_PACKAGED_FILES) {
      assert.equal(excluded in info.files, false, `${excluded} should be excluded`);
    }
    assert.ok('electron/main.js' in info.files);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const excluded of EXCLUDED_PACKAGED_FILES) {
    assert.ok(pkg.build.files.includes(`!${excluded}`), `package.json build.files must exclude ${excluded}`);
  }
});
