#!/usr/bin/env node
// 앱 버전을 한 곳에서 정한다: package.json version의 앞 두 자리 + 커밋 수.
//   package.json "1.2.0", main의 커밋이 67개 → 1.2.67
//
// 커밋 수는 저장소만 있으면 CI와 로컬이 똑같이 계산하므로, 같은 커밋으로 만든 로컬 설치본과 릴리스는 버전이 같다.
// 커밋이 늘 때마다 올라가서 자동 업데이트가 새 버전으로 인식한다.
// 주의: main 기록을 다시 쓰면(force push로 커밋을 줄이면) 버전이 내려가 자동 업데이트가 멈춘다. 그때는 앞 두 자리를 올린다.
//
//   node scripts/app-version.mjs            HEAD의 버전 출력
//   node scripts/app-version.mjs <커밋>     그 커밋의 버전 출력

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function baseVersion() {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const match = /^(\d+)\.(\d+)\.0$/.exec(version);
  if (!match) throw new Error(`package.json version은 "X.Y.0" 형식이어야 합니다 (지금: ${version}). 마지막 자리는 커밋 수로 채웁니다.`);
  return `${match[1]}.${match[2]}`;
}

export function appVersion(commit = 'HEAD') {
  if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: root, encoding: 'utf8' }).trim() === 'true') {
    throw new Error('얕은 clone이라 커밋 수를 셀 수 없습니다. 전체 기록을 받으세요 (actions/checkout은 fetch-depth: 0).');
  }
  const count = execFileSync('git', ['rev-list', '--count', commit], { cwd: root, encoding: 'utf8' }).trim();
  return `${baseVersion()}.${count}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(appVersion(process.argv[2])); }
  catch (error) { console.error(error.message); process.exit(1); }
}
