#!/usr/bin/env node
// 배포 버전과 앱이 인식하는 버전이 같은지 확인한다. 다르면 0이 아닌 코드로 끝난다.
//
// 로컬 설치본:  node scripts/check-version.mjs [--asar <app.asar>] [--expect <X.Y.Z>]
//   설치본 app.asar 안의 package.json 버전을 GitHub 최신 릴리스(latest.yml, 자동 업데이트가 읽는 파일)와 비교한다.
// 빌드 결과물:  node scripts/check-version.mjs --release-dir release --expect <X.Y.Z>
//   package.json, latest.yml, 설치 파일 이름, 빌드된 app.asar 버전이 모두 X.Y.Z인지 확인한다. (CI에서 사용)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

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

function defaultAsar() {
  const candidates = [
    path.resolve(root, '../resources/app.asar'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Planer', 'resources', 'app.asar'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Planer', 'resources', 'app.asar'),
  ].filter(Boolean);
  return candidates.find(file => fs.existsSync(file));
}

async function latestReleaseVersion() {
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
    if (!ymlText.includes(`Planer-Setup-${expected}.exe`)) problems.push(`latest.yml이 Planer-Setup-${expected}.exe를 가리키지 않음`);
  }

  for (const name of [`Planer-Setup-${expected}.exe`, `Planer-Setup-${expected}.exe.blockmap`]) {
    if (!fs.existsSync(path.join(releaseDir, name))) problems.push(`설치 파일 없음: ${name}`);
  }

  const builtAsar = path.join(releaseDir, 'win-unpacked', 'resources', 'app.asar');
  if (!fs.existsSync(builtAsar)) problems.push(`빌드된 app.asar 없음: ${builtAsar}`);
  else {
    const version = asarVersion(builtAsar);
    if (version !== expected) problems.push(`빌드된 앱 버전 ${version} ≠ ${expected}`);
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
  const expected = args.expect || await latestReleaseVersion();
  const source = args.expect ? '지정한 버전' : 'GitHub 최신 릴리스';

  console.log(`설치본: ${installed} (${asarFile})`);
  console.log(`${source}: ${expected}`);
  const order = compareVersions(installed, expected);
  if (order === 0) {
    console.log('일치: 같은 릴리스의 업데이트 알림이 뜨지 않습니다.');
    return;
  }
  if (order < 0) console.error(`불일치: 설치본이 더 낮아서 ${expected} 업데이트 알림이 뜹니다. 설치본을 ${expected}로 빌드하세요.`);
  else console.error(`불일치: 설치본이 ${source}보다 높습니다. 배포가 아직 끝나지 않았거나 버전을 잘못 올렸습니다.`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exit(2);
  });
}
