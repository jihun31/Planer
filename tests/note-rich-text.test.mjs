import test from 'node:test';
import assert from 'node:assert/strict';
import {noteRuns,noteHtml,notePlainText,serializeNoteRuns} from '../src/features/notes/noteRichText.mjs';
import {noteFormatAt,readNoteEditor} from '../src/features/notes/noteEditorDom.mjs';
import {youtubeToken} from '../src/features/notes/youtubeLinks.mjs';
import {recentNoteColor,rememberNoteColor} from '../src/features/notes/noteEditorPreferences.mjs';

test('plain notes and existing YouTube mentions retain their text, blank lines and links', () => {
  const url='https://www.youtube.com/watch?v=jNQXAC9IVRw';
  const text=`기존 메모\n\n${youtubeToken('영상 제목',url,'채널')}\n  공백도 유지`;
  assert.equal(serializeNoteRuns(noteRuns(text)),text);
  assert.equal(notePlainText(text),'기존 메모\n\n영상 제목\n  공백도 유지');
  assert.ok(noteHtml(text).includes('notes-youtube-mention'));
});

test('combined formatting and formatted mentions survive serialization and safe rendering', () => {
  const runs=[{text:'굵게',bold:true},{text:'밑줄',underline:true},{text:'강조',highlight:true},
    {text:'겹친 서식\n',bold:true,underline:true,highlight:true},
    {text:'<영상> "제목"',url:'https://www.youtube.com/watch?v=jNQXAC9IVRw',author:'<채널>',highlight:true}];
  const stored=serializeNoteRuns(runs);
  assert.deepEqual(noteRuns(stored),runs);
  const html=noteHtml(stored);
  assert.ok(html.includes('<strong>굵게</strong>'));
  assert.ok(html.includes('<u>밑줄</u>'));
  assert.ok(html.includes('background-color:#fff0a8'));
  assert.ok(html.includes('&lt;영상&gt;'));
  assert.ok(!html.includes('<영상>'));
  assert.equal(notePlainText(stored),'굵게밑줄강조겹친 서식\n<영상> "제목"');
});

test('removing formatting returns to plain storage and invalid rich documents remain literal safe text', () => {
  assert.equal(serializeNoteRuns([{text:'가'},{text:'나',bold:false}]),'가나');
  const rich=serializeNoteRuns([{text:'<img src=x onerror=alert(1)>',bold:true}]);
  assert.ok(!noteHtml(rich).includes('<img'));
  const prefix=rich.slice(0,rich.indexOf('['));
  const invalid=prefix+JSON.stringify([{text:'원문',html:'<script>bad()</script>'}]);
  assert.equal(notePlainText(invalid),invalid);
  assert.ok(!noteHtml(invalid).includes('<script>'));
  const literal=serializeNoteRuns([{text:rich}]);
  assert.equal(notePlainText(literal),rich);
});

const text=value=>({nodeType:3,nodeName:'#text',data:value});
test('recent text color persists between editors and tolerates unavailable preferences', () => {
  const values = new Map();
  const storage = {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  assert.equal(recentNoteColor(storage),'#0f172a');
  rememberNoteColor('#337ea9',storage);
  assert.equal(recentNoteColor(storage),'#337ea9');
  rememberNoteColor('invalid',storage);
  assert.equal(recentNoteColor(storage),'#337ea9');
  rememberNoteColor('#d44c47',storage);
  assert.equal(recentNoteColor(storage),'#d44c47');
  const blocked = {getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}};
  assert.equal(recentNoteColor(blocked),'#0f172a');
  assert.doesNotThrow(()=>rememberNoteColor('#337ea9',blocked));
});
function element(name,children=[],style={}) {
  const node={nodeName:name,nodeType:1,childNodes:children,firstChild:children[0],style};
  children.forEach(child=>{child.parentNode=node;});return node;
}

test('browser paragraphs, nested marks and explicit style removals serialize without losing newlines', () => {
  const root=element('DIV',[
    element('DIV',[element('B',[text('굵게'),element('SPAN',[text('해제')],{fontWeight:'normal'})])]),
    element('DIV',[element('U',[element('SPAN',[text('겹침')],{backgroundColor:'rgb(255, 240, 168)'})])]),
    element('DIV',[element('BR')]),element('DIV',[text('마지막')]),
  ]);
  const value=readNoteEditor(root);
  assert.equal(notePlainText(value),'굵게해제\n겹침\n\n마지막');
  assert.ok(noteRuns(value).some(run=>run.text==='굵게'&&run.bold));
  assert.ok(noteRuns(value).some(run=>run.text==='겹침'&&run.underline&&run.highlight));
  assert.ok(noteRuns(value).some(run=>run.text.includes('해제')&&!run.bold));
});

test('copying only part of a formatted text node retains inherited formatting', () => {
  const leaf=text('전체 문장');
  const root=element('DIV',[element('STRONG',[element('U',[leaf])])]);
  const inherited=noteFormatAt(leaf,root);
  const copied=readNoteEditor(element('FRAGMENT',[text('문장')]),inherited);
  assert.deepEqual(noteRuns(copied),[{text:'문장',bold:true,underline:true}]);
});

test('headings, quotes, bullets, italic and text colors survive storage without raw HTML', () => {
  const runs = [
    {text:'제목\n',block:'h1'}, {text:'작은 제목\n',block:'h2'}, {text:'세 번째 제목\n',block:'h3'},
    {text:'인용\n',block:'quote',italic:true}, {text:'첫 항목\n둘째 항목',block:'bullet',color:'#337ea9'},
  ];
  const stored = serializeNoteRuns(runs);
  assert.deepEqual(noteRuns(stored),runs);
  assert.equal(notePlainText(stored),'제목\n작은 제목\n세 번째 제목\n인용\n첫 항목\n둘째 항목');
  const html = noteHtml(stored);
  assert.ok(html.includes('<h1>제목</h1>'));
  assert.ok(html.includes('<h2>작은 제목</h2>'));
  assert.ok(html.includes('<h3>세 번째 제목</h3>'));
  assert.ok(html.includes('<blockquote><em>인용</em></blockquote>'));
  assert.equal((html.match(/<ul>/g) || []).length,1);
  assert.equal((html.match(/<li>/g) || []).length,2);
  assert.ok(html.includes('color:#337ea9'));
});

test('block DOM serialization preserves line boundaries, empty lines and inline styles', () => {
  const root = element('DIV',[
    element('H1',[text('제목')]), element('DIV',[text('본문')]),
    element('BLOCKQUOTE',[element('EM',[text('인용')],{color:'rgb(51, 126, 169)'})]),
    element('UL',[element('LI',[text('하나')]),element('LI',[text('둘')])]),
    element('DIV',[element('BR')]),element('H3',[text('마지막')]),
  ]);
  const stored = readNoteEditor(root);
  assert.equal(notePlainText(stored),'제목\n본문\n인용\n하나\n둘\n\n마지막');
  assert.ok(noteRuns(stored).some(run => run.block === 'quote' && run.italic && run.color === '#337ea9'));
  assert.ok(noteHtml(stored).includes('<div><br></div>'));
  assert.equal(noteHtml('첫 줄\n\n끝',true),'<div>첫 줄</div><div><br></div><div>끝</div>');
});

test('unsafe colors and unknown block types are never rendered as styles or tags', () => {
  const valid = serializeNoteRuns([{text:'제목',block:'h1'}]);
  const prefix = valid.slice(0,valid.indexOf('['));
  for (const run of [{text:'위험',color:'red; background:url(evil)'},{text:'위험',block:'script'}]) {
    const stored = prefix + JSON.stringify([run]);
    assert.equal(notePlainText(stored),stored);
    assert.ok(!noteHtml(stored).includes('<script>'));
    assert.ok(!noteHtml(stored).includes('style='));
  }
});

test('dividers survive saving and reopening between text, lists and blank lines', () => {
  const root = element('DIV',[
    element('DIV',[text('위 문장')]),element('HR'),element('DIV',[element('BR')]),
    element('UL',[element('LI',[text('항목')])]),element('HR'),element('DIV',[text('아래 문장')]),
  ]);
  const stored = readNoteEditor(root);
  assert.equal(notePlainText(stored),'위 문장\n---\n\n항목\n---\n아래 문장');
  assert.equal(noteHtml(stored,true),'<div>위 문장</div><hr><div><br></div><ul><li>항목</li></ul><hr><div>아래 문장</div>');
  assert.equal(serializeNoteRuns(noteRuns(stored)),stored);
  assert.equal(noteHtml(readNoteEditor(element('DIV',[element('HR'),element('DIV',[element('BR')])])),true),'<hr><div><br></div>');
});
