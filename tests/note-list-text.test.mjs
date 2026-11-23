import test from 'node:test';
import assert from 'node:assert/strict';
import {noteHtml,noteRuns,serializeNoteRuns} from '../src/features/notes/noteRichText.mjs';
import {noteClipboardText,noteListFromPlainText} from '../src/features/notes/noteListText.mjs';

test('pasted plain-text lists become list rows with depth, checks and start numbers',() => {
  const note = noteListFromPlainText('장보기\n- 우유\n  - 저지방\n* 빵\n[x] 계란\n- [ ] 사과\n\n3. 셋째\n4) 넷째\n');
  const runs = noteRuns(note);
  const line = text => runs.find(run => run.text.includes(text));
  assert.equal(line('장보기').block,undefined);
  assert.equal(line('우유').block,'bullet');
  assert.equal(line('저지방').listDepth,1);
  assert.equal(line('빵').block,'bullet');
  assert.deepEqual([line('계란').block,line('계란').checked],['checklist',true]);
  assert.deepEqual([line('사과').block,line('사과').checked],['checklist',false]);
  assert.equal(line('셋째').block,'numbered');
  assert.equal(line('셋째').listStart,3);
  assert.equal(line('넷째').listStart,undefined);
  assert.match(noteHtml(note,true),/<ol start="3"><li>셋째<\/li><li>넷째/);
});

test('pasting text without list markers or on one line keeps the normal paste',() => {
  assert.equal(noteListFromPlainText('첫 줄\n둘째 줄'),null);
  assert.equal(noteListFromPlainText('- 한 줄만'),null);
  assert.equal(noteListFromPlainText('3.14는 원주율\n2024.11.24'),null);
});

test('pasted list links stay clickable',() => {
  const runs = noteRuns(noteListFromPlainText('- https://example.com/a\n- 글'));
  assert.deepEqual(runs.find(run => run.url),{text:'https://example.com/a',url:'https://example.com/a',inlineLink:true,block:'bullet'});
});

test('copied lists keep markers, numbering and depth for other apps',() => {
  const note = serializeNoteRuns([
    {text:'제목\n'},
    {text:'첫째\n둘째',block:'numbered',listStart:5},{text:'\n',block:'numbered'},
    {text:'하위',block:'bullet',listDepth:1},{text:'\n',block:'bullet',listDepth:1},
    {text:'셋째',block:'numbered'},{text:'\n',block:'numbered'},
    {text:'할 일',block:'checklist',checked:false},{text:'\n',block:'checklist',checked:false},
    {text:'끝낸 일',block:'checklist',checked:true},
  ]);
  assert.equal(noteClipboardText(note),'제목\n5. 첫째\n6. 둘째\n  - 하위\n7. 셋째\n- [ ] 할 일\n- [x] 끝낸 일');
  assert.equal(noteListFromPlainText(noteClipboardText(note)) !== null,true);
});

test('list start numbers survive saving and stay off other blocks',() => {
  const note = serializeNoteRuns([{text:'다섯',block:'numbered',listStart:5},{text:'\n',block:'numbered',listStart:5},{text:'여섯',block:'numbered'}]);
  assert.deepEqual(noteRuns(note).map(run => run.listStart),[5,undefined]);
  assert.equal(noteRuns(serializeNoteRuns([{text:'글',block:'bullet',listStart:5}]))[0].listStart,undefined);
  assert.equal(noteRuns(serializeNoteRuns([{text:'하나',block:'numbered',listStart:1}]))[0].listStart,undefined);
  // A stored document with an invalid start is shown as text rather than trusted.
  const invalid = note.replace('"listStart":5','"listStart":"5"');
  assert.equal(noteRuns(invalid).length,1);
  assert.equal(noteRuns(invalid)[0].block,undefined);
});
