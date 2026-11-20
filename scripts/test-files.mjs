#!/usr/bin/env node
// tests/ 안의 테스트를 파일 이름으로 나눠 실행한다. 목록을 손으로 적지 않으므로 새 테스트도 자동으로 포함된다.
//
//   node scripts/test-files.mjs          단위 테스트 (*.test.mjs·*.test.cjs, 아래 두 종류 제외)   → npm test
//   node scripts/test-files.mjs --dom    화면 테스트 (*-dom.test.cjs, Electron 창을 띄움, 하나씩)  → npm run test:dom
//   node scripts/test-files.mjs --rules  Firestore 규칙 테스트 (*.rules.test.mjs, 에뮬레이터 필요)  → npm run test:rules
//   node scripts/test-files.mjs --list   어떤 파일이 어느 종류인지 출력

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const isTest = name => /\.test\.(mjs|cjs|js)$/.test(name);
export const isDomTest = name => /-dom\.test\.(mjs|cjs|js)$/.test(name);
export const isRulesTest = name => /\.rules\.test\.(mjs|cjs|js)$/.test(name);
export const isUnitTest = name => isTest(name) && !isDomTest(name) && !isRulesTest(name);

export function testFiles(filter = isTest) {
  return fs.readdirSync(path.join(root, 'tests'))
    .filter(name => filter(name))
    .sort()
    .map(name => `tests/${name}`);
}

function run(command, args) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  return spawnSync(command, args, { cwd: root, stdio: 'inherit' }).status ?? 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const [label, filter] of [['단위', isUnitTest], ['화면(DOM)', isDomTest], ['Firestore 규칙', isRulesTest]]) {
      const files = testFiles(filter);
      console.log(`${label} ${files.length}개:\n  ${files.join('\n  ')}`);
    }
    return;
  }

  if (args.includes('--dom')) {
    const files = testFiles(isDomTest);
    const failed = files.filter(file => run(process.execPath, [file]) !== 0);
    console.log(`\n화면 테스트 ${files.length - failed.length}/${files.length}개 통과`);
    if (failed.length) {
      console.error(`실패:\n  ${failed.join('\n  ')}`);
      process.exit(1);
    }
    return;
  }

  const rules = args.includes('--rules');
  const files = testFiles(rules ? isRulesTest : isUnitTest);
  if (!files.length) { console.error(`${rules ? '규칙' : '단위'} 테스트 파일을 찾지 못했습니다`); process.exit(1); }
  process.exit(run(process.execPath, ['--test', ...files]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
