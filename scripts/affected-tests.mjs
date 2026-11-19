#!/usr/bin/env node
// 바뀐 파일과 직접 관련된 테스트만 골라 준다. 사람이나 에이전트가 테스트를 고르지 않게 하려는 스크립트.
//
//   node scripts/affected-tests.mjs                 작업 트리 변경(커밋 전 + 새 파일) 기준으로 목록 출력
//   node scripts/affected-tests.mjs --base main     main 이후 커밋 + 작업 트리 변경 기준
//   node scripts/affected-tests.mjs --run           고른 테스트를 바로 실행
//   node scripts/affected-tests.mjs -- src/a.js     지정한 파일 기준
//
// 테스트 파일이 import·readFileSync·HTML <script src> 등으로 가리키는 파일을 따라가며
// 의존 관계를 만들고, 바뀐 파일에 닿는 테스트만 고른다. 실행 방법은 package.json scripts에서 찾는다.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toPosix = file => file.split(path.sep).join('/');
const rel = file => toPosix(path.relative(root, file));

const SOURCE_EXTS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.rules'];
const ROOT_PREFIXES = ['src/', 'electron/', 'tests/', 'public/'];
// 의존 그래프로 잡히지 않는 경로: 테스트 대신 실행할 명령
const EXTRA_RULES = [
  { match: file => file.startsWith('bot/'), command: 'npm run test:bot', reason: 'Discord 봇' },
];
// 바뀌면 영향 범위를 좁힐 수 없는 파일
const BROAD_FILES = new Set(['package.json', 'package-lock.json', 'vite.config.mjs', 'index.html', '.oxlintrc.json']);

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}
function isDir(file) {
  try { return fs.statSync(file).isDirectory(); } catch { return false; }
}

function resolveCandidate(spec, fromDir) {
  const bases = [];
  if (spec.startsWith('./') || spec.startsWith('../')) bases.push(path.resolve(fromDir, spec));
  else if (spec.startsWith('/')) bases.push(path.join(root, spec.slice(1)));
  else if (ROOT_PREFIXES.some(prefix => spec.startsWith(prefix))) bases.push(path.join(root, spec));
  else if (SOURCE_EXTS.includes(path.extname(spec))) bases.push(path.join(fromDir, spec), path.join(root, spec));
  else return null;

  for (const base of bases) {
    if (isFile(base)) return { file: base };
    if (isDir(base)) {
      for (const ext of SOURCE_EXTS) if (isFile(path.join(base, 'index' + ext))) return { file: path.join(base, 'index' + ext) };
      return { dir: base };
    }
    if (!path.extname(base)) {
      for (const ext of SOURCE_EXTS) if (isFile(base + ext)) return { file: base + ext };
    }
  }
  return null;
}

const referenceCache = new Map();

export function referencesOf(file) {
  if (referenceCache.has(file)) return referenceCache.get(file);
  const result = new Set();
  referenceCache.set(file, result);
  if (!SOURCE_EXTS.includes(path.extname(file))) return result;

  const text = fs.readFileSync(file, 'utf8');
  const fromDir = path.dirname(file);
  const strings = [];
  for (const match of text.matchAll(/(['"`])([^'"`\n]{1,200}?)\1/g)) {
    const spec = match[2].split(/[?#]/)[0];
    if (!spec || spec.includes('${') || /^[a-z]+:/i.test(spec)) continue;
    strings.push(spec);
  }

  const dirs = [];
  const unresolved = [];
  for (const spec of strings) {
    const hit = resolveCandidate(spec, fromDir);
    if (hit?.file) result.add(hit.file);
    else if (hit?.dir) dirs.push(hit.dir);
    else if (path.extname(spec)) unresolved.push(spec);
  }
  for (const spec of unresolved) {
    // readFileSync('src/features/' + file) 처럼 디렉터리 + 상대 경로를 이어 붙이는 경우
    if (!spec.startsWith('.') && !spec.startsWith('/')) {
      for (const dir of dirs) {
        const candidate = path.join(dir, spec);
        if (isFile(candidate)) result.add(candidate);
      }
    }
    // 테스트가 띄운 fixture HTML 기준의 상대 경로 (예: Electron에서 import('../../src/...'))
    if (spec.startsWith('../') || spec.startsWith('./')) {
      for (const file of [...result]) {
        const hit = resolveCandidate(spec, path.dirname(file));
        if (hit?.file) result.add(hit.file);
      }
    }
  }
  result.delete(file);
  return result;
}

// 빌드 결과물·의존성 폴더는 따라가지 않는다 (dist/index.html → 번들 → 앱 전체로 번지는 것 방지)
const SKIP_DIRS = ['node_modules', 'dist', 'release', '.tmp', '.git'].map(name => path.join(root, name) + path.sep);
// 루트 index.html은 앱 전체로 이어지는 진입점이라 따라가지 않는다 (바뀌면 BROAD_FILES로 따로 알림)
const APP_ENTRY = path.join(root, 'index.html');
const skipped = file => file === APP_ENTRY || file.includes(`${path.sep}node_modules${path.sep}`) || SKIP_DIRS.some(dir => file.startsWith(dir));

export function dependencyClosure(entry) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    for (const next of referencesOf(queue.pop())) {
      if (seen.has(next) || skipped(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function testFiles() {
  return fs.readdirSync(path.join(root, 'tests'))
    .filter(name => /\.test\.(mjs|cjs|js)$/.test(name))
    .map(name => path.join(root, 'tests', name));
}

// package.json scripts를 보고 테스트 파일 하나를 실행하는 방법을 정한다.
function runPlan(tests) {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts || {};
  const npmScripts = new Set();
  const nodeTest = [];
  const plainNode = [];
  const unscripted = [];
  for (const test of tests) {
    const name = rel(test);
    const owners = Object.entries(scripts).filter(([, command]) => command.split(/\s+/).some(token => token.replace(/^["']|["']$/g, '') === name));
    const dedicated = owners.find(([key]) => key !== 'test');
    if (dedicated) npmScripts.add(`npm run ${dedicated[0]}`);
    else if (owners.length) nodeTest.push(name);
    else {
      unscripted.push(name);
      (/-dom\.test\./.test(name) ? plainNode : nodeTest).push(name);
    }
  }
  const commands = [];
  if (nodeTest.length) commands.push(`node --test ${nodeTest.join(' ')}`);
  for (const name of plainNode) commands.push(`node ${name}`);
  commands.push(...npmScripts);
  return { commands, unscripted };
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\n').map(line => line.trim()).filter(Boolean);
}

function changedFiles(base) {
  const files = new Set([
    ...git(['diff', '--name-only', 'HEAD']),
    ...git(['ls-files', '--others', '--exclude-standard']),
  ]);
  if (base) for (const file of git(['diff', '--name-only', `${base}...HEAD`])) files.add(file);
  return [...files].map(toPosix);
}

export function selectTests(changed) {
  const tests = testFiles();
  const closures = new Map(tests.map(test => [test, dependencyClosure(test)]));
  const selected = new Set();
  const extra = new Map();
  const uncovered = [];
  const broad = [];

  for (const file of changed) {
    const absolute = path.join(root, file);
    let covered = false;
    for (const [test, closure] of closures) {
      if (closure.has(absolute)) { selected.add(test); covered = true; }
    }
    for (const rule of EXTRA_RULES) {
      if (rule.match(file)) { extra.set(rule.command, rule.reason); covered = true; }
    }
    if (BROAD_FILES.has(file)) broad.push(file);
    else if (!covered && /^(src|electron|public)\//.test(file)) uncovered.push(file);
  }
  return { selected: [...selected], extra, uncovered, broad };
}

function main() {
  const argv = process.argv.slice(2);
  const run = argv.includes('--run');
  const baseIndex = argv.indexOf('--base');
  const base = baseIndex >= 0 ? argv[baseIndex + 1] : null;
  const dashIndex = argv.indexOf('--');
  const changed = dashIndex >= 0 ? argv.slice(dashIndex + 1).map(toPosix) : changedFiles(base);

  if (!changed.length) {
    console.log('바뀐 파일이 없습니다.');
    return;
  }
  const { selected, extra, uncovered, broad } = selectTests(changed);
  const { commands, unscripted } = runPlan(selected);
  commands.push(...extra.keys());

  console.log(`바뀐 파일 ${changed.length}개:`);
  for (const file of changed) console.log(`  ${file}`);
  console.log(`\n관련 테스트 ${selected.length}개:`);
  for (const test of selected.map(rel).sort()) console.log(`  ${test}`);
  if (unscripted.length) console.log(`\n경고: package.json scripts에 없는 테스트 (npm test·CI에서 안 돌아감):\n  ${unscripted.join('\n  ')}`);
  if (uncovered.length) console.log(`\n자동 테스트가 닿지 않는 파일 (앱을 실행해서 직접 확인):\n  ${uncovered.join('\n  ')}`);
  if (broad.length) console.log(`\n영향 범위를 좁힐 수 없는 파일이 바뀜 → 전체 테스트(npm test) 여부를 사용자에게 확인:\n  ${broad.join('\n  ')}`);
  console.log(`\n실행할 명령:${commands.length ? '' : ' 없음'}`);
  for (const command of commands) console.log(`  ${command}`);

  if (!run || !commands.length) return;
  const failed = [];
  for (const command of commands) {
    console.log(`\n$ ${command}`);
    const result = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true });
    if (result.status !== 0) failed.push(command);
  }
  if (failed.length) {
    console.error(`\n실패한 명령:\n  ${failed.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\n관련 테스트 모두 통과');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
