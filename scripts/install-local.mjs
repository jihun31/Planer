#!/usr/bin/env node
// 커밋된 소스로 앱을 빌드해 이 PC에 설치된 Planner에 바로 적용한다 (push·배포 없이).
//
//   npm run install:local            빌드 → 백업 → 교체 → check:version → Planner 다시 실행
//   npm run install:local -- --no-start   교체 후 Planner를 실행하지 않음
//
// 버전은 CI 릴리스와 같은 규칙(scripts/app-version.mjs: package.json 앞 두 자리 + 커밋 수)으로 정한다.
// 인터넷 없이 정해지고, 이 커밋을 push하면 같은 버전으로 릴리스되므로 같은 버전의 업데이트 알림이 뜨지 않는다.
// 더 새 커밋이 릴리스되면 커밋 수가 커서 자동 업데이트가 그 릴리스로 덮어쓴다.
// 백업은 설치 폴더 밖(.tmp/app-backups)에 최근 3개만 둔다. 설치 폴더는 업데이트 때 통째로 지워진다.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultAsar, verifyBuildInfo } from './check-version.mjs';
import { appVersion } from './app-version.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = message => { console.error(message); process.exit(1); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function running(image) {
  const output = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8' });
  return output.split('\n').some(line => line.toLowerCase().startsWith(`"${image.toLowerCase()}`));
}

export const SETUP_IMAGE_PATTERN = /^"plann?er-setup[^"]*\.exe"/i;

export function hasRunningSetup(tasklistCsv) {
  return tasklistCsv.split('\n').some(line => SETUP_IMAGE_PATTERN.test(line.trimStart()));
}

function setupRunning() {
  const output = execFileSync('tasklist', ['/NH', '/FO', 'CSV'], { encoding: 'utf8' });
  return hasRunningSetup(output);
}

async function main() {
  const noStart = process.argv.includes('--no-start');
  if (process.platform !== 'win32') fail('Windows에서만 쓸 수 있습니다.');

  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
  if (dirty) fail(`커밋 안 된 변경이 있습니다. 설치본은 커밋된 소스로만 만듭니다. 먼저 커밋하세요.\n${dirty}`);

  const installed = defaultAsar();
  if (!installed) fail('설치된 Planner(resources/app.asar)를 찾지 못했습니다.');
  const installDir = path.dirname(path.dirname(installed));
  if (path.resolve(root).toLowerCase().startsWith(path.resolve(installDir).toLowerCase() + path.sep)) {
    fail('저장소가 설치 폴더 안에 있습니다. 업데이트 때 지워지므로 설치 폴더 밖으로 옮기세요.');
  }

  // Planner를 종료하면 내려받아 둔 업데이트가 설치될 수 있다. 그 설치가 끝난 뒤에 교체해야 덮어쓰이지 않는다.
  if (running('Planer.exe')) fail('Planner가 실행 중입니다. Planner를 종료한 뒤 다시 실행하세요.');
  for (let waited = 0; setupRunning(); waited += 5) {
    if (waited === 0) console.log('업데이트 설치가 진행 중이라 끝날 때까지 기다립니다...');
    if (waited >= 300) fail('업데이트 설치가 5분 넘게 끝나지 않습니다. 설치 창을 확인하세요.');
    await sleep(5000);
  }

  const version = appVersion();
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  console.log(`빌드: 커밋 ${commit}, 버전 ${version}`);
  // electronDist: 설치된 electron 패키지의 dist를 복사해 쓴다. electron-builder가 Electron zip을 풀어
  // win-unpacked.tmp → win-unpacked로 이름을 바꾸는 단계가 이 PC에서 EPERM으로 계속 실패해서다(2026-11-20).
  const build = spawnSync(`npm run app:local -- -c.extraMetadata.version=${version} -c.electronDist=node_modules/electron/dist`,
    { cwd: root, stdio: 'inherit', shell: true });
  if (build.status !== 0) fail('빌드에 실패했습니다. 설치본은 바꾸지 않았습니다.');

  const built = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
  const { problems } = verifyBuildInfo(built);
  if (problems.length) fail(`빌드 결과 검사 실패, 설치본은 바꾸지 않았습니다:\n- ${problems.join('\n- ')}`);
  if (running('Planer.exe') || setupRunning()) fail('빌드하는 동안 Planner나 업데이트 설치가 실행됐습니다. 종료한 뒤 다시 실행하세요.');

  const backups = path.join(root, '.tmp', 'app-backups');
  fs.mkdirSync(backups, { recursive: true });
  const backup = path.join(backups, `app.asar.${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.copyFileSync(installed, backup);
  for (const old of fs.readdirSync(backups).filter(name => name.startsWith('app.asar.')).sort().slice(0, -3)) {
    fs.rmSync(path.join(backups, old));
  }
  fs.copyFileSync(built, installed);
  console.log(`교체 완료: ${installed}\n이전 설치본 백업: ${backup}`);
  fs.rmSync(path.join(root, 'release'), { recursive: true, force: true });

  const check = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-version.mjs')], { cwd: root, stdio: 'inherit' });
  if (check.status !== 0) fail(`검사에 실패했습니다. 되돌리려면 Planner를 종료하고 백업을 복사하세요:\n  ${backup} → ${installed}`);

  if (!noStart) {
    spawn(path.join(installDir, 'Planer.exe'), [], { detached: true, stdio: 'ignore' }).unref();
    console.log('Planner를 다시 실행했습니다.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => fail(error.message));
}
