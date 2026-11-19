#!/usr/bin/env node
// 빌드 직후(vite build 다음, electron-builder 전) 앱에 들어갈 파일의 지문(SHA-256)을
// dist/build-info.json에 기록한다. check-version.mjs가 설치본을 다시 해시해 비교하므로,
// 빌드 뒤에 app.asar를 손으로 고치면 검사가 실패한다.
//
//   node scripts/write-build-info.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD_INFO = 'dist/build-info.json';
// electron-builder의 build.files와 같은 범위 (앱에 실제로 들어가는 코드)
export const PACKAGED_DIRS = ['dist', 'electron'];
// 릴리스 CI는 빌드 전에 package.json 버전만 바꾸므로, 이 둘의 변경은 "커밋 안 된 변경"으로 보지 않는다.
const VERSION_FILES = new Set(['package.json', 'package-lock.json']);

export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function listFiles(dir, base) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

export function collectHashes(appRoot) {
  const files = {};
  for (const dir of PACKAGED_DIRS) {
    const full = path.join(appRoot, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of listFiles(full, appRoot).sort()) {
      if (file === BUILD_INFO) continue;
      files[file] = sha256(fs.readFileSync(path.join(appRoot, file)));
    }
  }
  return files;
}

function gitState(appRoot) {
  try {
    const git = args => execFileSync('git', args, { cwd: appRoot, encoding: 'utf8' });
    // -z: one NUL-separated "XY path" entry per file, paths unquoted (renames add the old path as a separate entry).
    const entries = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean);
    const changed = [];
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (/^R|^C/.test(entry)) index++;
      if (!VERSION_FILES.has(entry.slice(3))) changed.push(entry.slice(3));
    }
    return { commit: git(['rev-parse', 'HEAD']).trim(), uncommitted: changed };
  } catch {
    return { commit: null, uncommitted: null };
  }
}

export function writeBuildInfo(appRoot = root) {
  if (!fs.existsSync(path.join(appRoot, 'dist'))) throw new Error('dist가 없습니다. 먼저 vite build를 실행하세요');
  const info = { ...gitState(appRoot), builtAt: new Date().toISOString(), files: collectHashes(appRoot) };
  fs.writeFileSync(path.join(appRoot, BUILD_INFO), JSON.stringify(info, null, 2) + '\n');
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const info = writeBuildInfo();
  const count = Object.keys(info.files).length;
  console.log(`빌드 정보 기록: 파일 ${count}개, 커밋 ${info.commit?.slice(0, 7) ?? '알 수 없음'}`
    + (info.uncommitted?.length ? ` (커밋 안 된 변경 ${info.uncommitted.length}개 포함)` : ''));
}
