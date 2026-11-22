#!/usr/bin/env node
// 배포 버전과 앱이 인식하는 버전이 같은지, 앱이 빌드한 그대로인지 확인한다. 문제가 있으면 0이 아닌 코드로 끝난다.
//
// 로컬 설치본:  node scripts/check-version.mjs [--asar <app.asar>] [--expect <X.Y.Z>]
//   설치본 app.asar 안의 버전을 그 설치본을 빌드한 커밋의 버전(scripts/app-version.mjs)과 비교하고,
//   앱 파일의 지문을 빌드 때 기록(dist/build-info.json)과 비교한다. GitHub 최신 릴리스(latest.yml)와의 관계도 알려 준다.
// 빌드 결과물:  node scripts/check-version.mjs --release-dir release --expect <X.Y.Z>
//   package.json, latest.yml, 설치 파일 이름, 빌드된 app.asar 버전이 모두 X.Y.Z이고 빌드 기록과 같은지 확인한다. (CI에서 사용)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BUILD_INFO, PACKAGED_DIRS, sha256 } from './write-build-info.mjs';
import { appVersion } from './app-version.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`알 수 없는 인자: ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} 값이 필요합니다`);
    args[key.slice(2)] = value;
    i++;
  }
  return args;
}

export function compareVersions(a, b) {
  const pa = a.split(/[.-]/).map(Number);
  const pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

export function versionFromLatestYml(text) {
  const match = /^version:\s*['"]?([^'"\s]+)/m.exec(text);
  if (!match) throw new Error('latest.yml에서 version을 찾지 못했습니다');
  return match[1];
}

function asarVersion(file) {
  const asar = require('@electron/asar');
  return JSON.parse(asar.extractFile(file, 'package.json').toString('utf8')).version;
}

// app.asar 안의 dist/·electron/ 파일을 다시 해시해 빌드 때 기록한 지문(dist/build-info.json)과 비교한다.
// 빌드 뒤에 손으로 고친 파일, 빠지거나 더해진 파일, 커밋 안 된 변경으로 만든 빌드를 문제로 돌려준다.
export function verifyBuildInfo(file) {
  const asar = require('@electron/asar');
  const entries = new Map();
  for (const raw of asar.listPackage(file)) {
    const inner = raw.replace(/^[\\/]/, '');
    const name = inner.split(path.sep).join('/');
    if (!PACKAGED_DIRS.some(dir => name.startsWith(dir + '/'))) continue;
    if ('files' in asar.statFile(file, inner, false)) continue;
    entries.set(name, inner);
  }
  const infoPath = entries.get(BUILD_INFO);
  if (!infoPath) return { info: null, problems: ['빌드 정보(dist/build-info.json)가 없습니다. 해시 검사를 넣기 전 빌드이거나 asar를 직접 만든 것입니다. npm run build로 다시 빌드하세요.'] };
  const info = JSON.parse(asar.extractFile(file, infoPath).toString('utf8'));
  const problems = [];
  if (!info.commit) problems.push('어느 커밋으로 빌드했는지 기록되지 않았습니다.');
  if (info.uncommitted?.length) problems.push(`커밋 안 된 변경으로 빌드했습니다: ${info.uncommitted.join(', ')}`);
  const changed = [], missing = [], extra = [];
  for (const [name, hash] of Object.entries(info.files || {})) {
    if (!entries.has(name)) missing.push(name);
    else if (sha256(asar.extractFile(file, entries.get(name))) !== hash) changed.push(name);
  }
  for (const name of entries.keys()) if (name !== BUILD_INFO && !(name in (info.files || {}))) extra.push(name);
  if (changed.length) problems.push(`빌드한 뒤에 바뀐 파일: ${changed.join(', ')}`);
  if (missing.length) problems.push(`빌드 정보에는 있는데 앱에 없는 파일: ${missing.join(', ')}`);
  if (extra.length) problems.push(`빌드 정보에 없는 파일이 앱에 들어 있음: ${extra.join(', ')}`);
  return { info, problems };
}

async function releaseCommit(tag) {
  const publish = (pkg.build?.publish || []).find(item => item.provider === 'github');
  try {
    const response = await fetch(`https://api.github.com/repos/${publish.owner}/${publish.repo}/releases/tags/${tag}`,
      { headers: { accept: 'application/vnd.github+json' } });
    if (!response.ok) return null;
    const commit = (await response.json()).target_commitish;
    return /^[0-9a-f]{40}$/.test(commit) ? commit : null;
  } catch { return null; }
}

export function defaultAsar() {
  // The repository lives outside the install folder (the updater wipes that folder on install).
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Planer', 'resources', 'app.asar'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Planer', 'resources', 'app.asar'),
  ].filter(Boolean);
  return candidates.find(file => fs.existsSync(file));
}

export async function latestReleaseVersion() {
  const publish = (pkg.build?.publish || []).find(item => item.provider === 'github');
  if (!publish) throw new Error('package.json build.publish에 github 설정이 없습니다');
  const url = `https://github.com/${publish.owner}/${publish.repo}/releases/latest/download/latest.yml`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`최신 릴리스 정보를 받지 못했습니다 (${response.status}): ${url}`);
  return versionFromLatestYml(await response.text());
}

function checkRelease(dir, expected) {
  const problems = [];
  const releaseDir = path.resolve(root, dir);
  if (pkg.version !== expected) problems.push(`package.json version ${pkg.version} ≠ ${expected}`);

  const yml = path.join(releaseDir, 'latest.yml');
  if (!fs.existsSync(yml)) problems.push(`latest.yml 없음: ${yml}`);
  else {
    const ymlText = fs.readFileSync(yml, 'utf8');
    const ymlVersion = versionFromLatestYml(ymlText);
    if (ymlVersion !== expected) problems.push(`latest.yml version ${ymlVersion} ≠ ${expected}`);
    if (!ymlText.includes(`Planner-Setup-${expected}.exe`)) problems.push(`latest.yml이 Planner-Setup-${expected}.exe를 가리키지 않음`);
  }

  for (const name of [`Planner-Setup-${expected}.exe`, `Planner-Setup-${expected}.exe.blockmap`]) {
    if (!fs.existsSync(path.join(releaseDir, name))) problems.push(`설치 파일 없음: ${name}`);
  }

  const builtAsar = path.join(releaseDir, 'win-unpacked', 'resources', 'app.asar');
  if (!fs.existsSync(builtAsar)) problems.push(`빌드된 app.asar 없음: ${builtAsar}`);
  else {
    const version = asarVersion(builtAsar);
    if (version !== expected) problems.push(`빌드된 앱 버전 ${version} ≠ ${expected}`);
    problems.push(...verifyBuildInfo(builtAsar).problems);
  }
  return problems;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args['release-dir']) {
    if (!args.expect) throw new Error('--release-dir에는 --expect <X.Y.Z>가 필요합니다');
    const problems = checkRelease(args['release-dir'], args.expect);
    if (problems.length) {
      console.error(`릴리스 버전 불일치 (기대값 ${args.expect}):\n- ${problems.join('\n- ')}`);
      process.exit(1);
    }
    console.log(`릴리스 버전 일치: ${args.expect}`);
    return;
  }

  const asarFile = args.asar ? path.resolve(args.asar) : defaultAsar();
  if (!asarFile || !fs.existsSync(asarFile)) throw new Error('설치본 app.asar를 찾지 못했습니다. --asar로 경로를 지정하세요');
  const installed = asarVersion(asarFile);
  const { info, problems } = verifyBuildInfo(asarFile);
  let failed = false;

  // 기준: 설치본을 빌드한 커밋의 버전(scripts/app-version.mjs). 그 커밋이 로컬에 없거나 기록이 없으면 GitHub 최신 릴리스.
  let expected = args.expect;
  let source = '지정한 버전';
  if (!expected && info?.commit) {
    try { expected = appVersion(info.commit); source = `커밋 ${info.commit.slice(0, 7)}의 버전`; } catch { /* 커밋이 로컬에 없음 */ }
  }
  if (!expected) { expected = await latestReleaseVersion(); source = 'GitHub 최신 릴리스'; }

  console.log(`설치본: ${installed} (${asarFile})`);
  console.log(`${source}: ${expected}`);
  if (compareVersions(installed, expected) === 0) console.log('버전 일치');
  else {
    failed = true;
    console.error(`버전 불일치: 설치본 ${installed} ≠ ${expected}. npm run install:local로 다시 빌드하세요.`);
  }

  if (problems.length) {
    failed = true;
    console.error(`빌드 검사 실패: 설치본이 빌드한 그대로가 아닙니다.\n- ${problems.join('\n- ')}`);
  } else {
    console.log(`빌드 검사 통과: 파일 ${Object.keys(info.files).length}개가 빌드 기록과 같습니다 (커밋 ${info.commit.slice(0, 7)}).`);
  }

  // GitHub 릴리스와 비교 (인터넷이 없으면 건너뜀). 자동 업데이트가 설치본을 어떻게 다룰지 알려 준다.
  if (!args.expect && source !== 'GitHub 최신 릴리스') {
    let latest = null;
    try { latest = await latestReleaseVersion(); } catch (error) { console.log(`참고: GitHub 릴리스를 확인하지 못했습니다 (${error.message}).`); }
    if (latest) {
      const order = compareVersions(installed, latest);
      if (order < 0) console.log(`참고: GitHub에 더 새 릴리스 ${latest}가 있어 업데이트 알림이 뜹니다. 최신 소스를 받아 다시 설치하거나 업데이트하세요.`);
      else if (order > 0) console.log(`참고: GitHub 최신 릴리스는 ${latest}입니다. 이 설치본은 아직 배포 전 커밋이고, push하면 같은 버전 ${installed}로 릴리스됩니다.`);
      else if (info?.commit) {
        const released = await releaseCommit('v' + latest);
        if (released && released !== info.commit) {
          failed = true;
          console.error(`같은 버전 ${latest}인데 릴리스 커밋(${released.slice(0, 7)})과 설치본 커밋(${info.commit.slice(0, 7)})이 다릅니다. 로컬 기록이 main과 갈라졌습니다. git pull로 맞춘 뒤 다시 설치하세요.`);
        }
      }
    }
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exit(2);
  });
}
