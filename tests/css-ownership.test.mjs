// 스타일시트는 모두 전역이라, 클래스 이름이 겹치거나 불러오는 순서가 바뀌면 다른 화면이 깨진다.
// 1) 모든 스타일시트는 src/styles/index.js에서 정해진 순서로 시작할 때 불러온다(탭 코드를 나중에 받아도 순서가 같다).
// 2) 한 클래스의 기본 규칙(`.이름`, `.이름:hover`처럼 그 클래스 하나만 고르는 규칙)은 한 파일에만 둔다.
//    다른 파일에서 바꾸려면 `.부모 .이름`, `.이름.변형`처럼 범위를 좁혀 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stylesDir = path.join(root, 'src/styles');
const stylesIndex = path.join(stylesDir, 'index.js');
const sheets = fs.readdirSync(stylesDir).filter(file => file.endsWith('.css')).sort();
const indexedSheets = [...fs.readFileSync(stylesIndex, 'utf8').matchAll(/^import '\.\/([\w-]+\.css)';$/gm)].map(match => match[1]);

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(jsx?|mjs)$/.test(entry.name) ? [file] : [];
  });
}

function splitSelectors(text) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(' || text[i] === '[') depth++;
    else if (text[i] === ')' || text[i] === ']') depth--;
    else if (text[i] === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

// `.이름`에 상태(:hover, ::before, [attr])만 붙은 선택자면 그 클래스 이름을 돌려준다.
export function baseClassOf(selector) {
  const match = /^\.([A-Za-z_][\w-]*)((?::{1,2}[\w-]+(?:\([^)]*\))?|\[[^\]]*\])*)$/.exec(selector);
  return match ? match[1] : null;
}

export function baseClassOwners(files) {
  const owners = new Map();
  for (const file of files) {
    const text = fs.readFileSync(path.join(stylesDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, prelude] of text.matchAll(/([^{}]+)\{/g)) {
      if (prelude.trim().startsWith('@')) continue;
      for (const selector of splitSelectors(prelude)) {
        const name = baseClassOf(selector);
        if (!name) continue;
        if (!owners.has(name)) owners.set(name, new Set());
        owners.get(name).add(file);
      }
    }
  }
  return owners;
}

test('every stylesheet is loaded once, in order, from src/styles/index.js', () => {
  assert.deepEqual([...indexedSheets].sort(), sheets, 'src/styles/index.js must import every src/styles/*.css exactly once');
  assert.equal(new Set(indexedSheets).size, indexedSheets.length, 'a stylesheet is imported twice in src/styles/index.js');
  const main = fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8');
  const stylesAt = main.indexOf("import './styles/index.js'"), appAt = main.indexOf("import App from './App.jsx'");
  assert.ok(stylesAt >= 0 && stylesAt < appAt, 'src/main.jsx must import ./styles/index.js before App');
});

test('component CSS imports only point at stylesheets in src/styles', () => {
  for (const file of sourceFiles(path.join(root, 'src'))) {
    if (file === stylesIndex) continue;
    for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)) {
      const target = path.resolve(path.dirname(file), spec);
      assert.equal(path.dirname(target), stylesDir, `${path.relative(root, file)} imports ${spec}, which src/styles/index.js does not order`);
      assert.ok(sheets.includes(path.basename(target)), `${path.relative(root, file)} imports missing ${spec}`);
    }
  }
});

test('a class has its base rule in only one stylesheet', () => {
  const shared = [...baseClassOwners(sheets)].filter(([, files]) => files.size > 1)
    .map(([name, files]) => `.${name}: ${[...files].join(', ')}`);
  assert.deepEqual(shared, [], 'Give each class one owning stylesheet; scope overrides elsewhere with a parent or modifier class');
});

test('base-rule detection ignores scoped and compound selectors', () => {
  assert.equal(baseClassOf('.btn'), 'btn');
  assert.equal(baseClassOf('.btn:hover'), 'btn');
  assert.equal(baseClassOf('.btn[aria-pressed="true"]::after'), 'btn');
  assert.equal(baseClassOf('.panel .btn'), null);
  assert.equal(baseClassOf('.btn.danger'), null);
  assert.equal(baseClassOf('button.btn'), null);
});
