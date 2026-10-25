import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {noteRuns,noteHtml,notePlainText,serializeNoteRuns,createNoteToggle} from '../src/features/notes/noteRichText.mjs';
import {noteFormatAt,readNoteEditor,restoreNoteSelection} from '../src/features/notes/noteEditorDom.mjs';
import {youtubeToken,escapeHtml,youtubeVideo} from '../src/features/notes/youtubeLinks.mjs';
import {webLink} from '../src/features/notes/siteLinks.mjs';
import {recentNoteColor,rememberNoteColor,toggledNoteColor} from '../src/features/notes/noteEditorPreferences.mjs';
import {startNoteTextDrag,noteTextDropAllowed} from '../src/features/notes/noteTextDrag.mjs';

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

test('manual strikethrough preserves mixed inline styles and is independent of checklist completion',()=>{
  const runs=[{text:'취소선',strike:true,bold:true,underline:true,color:'#337ea9'},
    {text:'\n완료',block:'checklist',checked:true},
    {text:'\n수동 취소선',block:'checklist',checked:false,strike:true}];
  const stored=serializeNoteRuns(runs);
  assert.deepEqual(noteRuns(stored),runs);
  assert.ok(noteHtml(stored).includes('<s>'));
  assert.equal(noteRuns(stored)[1].strike,undefined,'Completion must not become manual strike formatting');
  assert.equal(noteRuns(stored)[2].checked,false);
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

test('direct slash commands wait for Korean composition to finish and respect modified keys', () => {
  const source=fs.readFileSync('src/components/notes/NoteTextEditor.jsx','utf8');
  const start=source.lastIndexOf('      onKeyDown={event => {');
  const body=source.slice(start+'      onKeyDown={event => {'.length,source.indexOf("        if ((event.ctrlKey || event.metaKey)",start));
  const applied=[],composing={current:false},dismissedSlash={current:null};
  const context=vm.createContext({loading:false,readOnly:false,composing,dismissedSlash,editor:{current:{}},window:{getSelection:()=>({})},
    noteSlashShortcut:()=>({type:'h3',range:'command-range'}),applyBlock:(...args)=>applied.push(args)});
  vm.runInContext('globalThis.keyDown=event=>{'+body+'};',context);
  const key=(overrides={})=>context.keyDown({key:'Enter',nativeEvent:{isComposing:false},preventDefault(){},...overrides});
  key({nativeEvent:{isComposing:true}});key({keyCode:229});
  composing.current=true;key();composing.current=false;
  key({ctrlKey:true});key({shiftKey:true});
  assert.equal(applied.length,0);
  key();key({key:' '});
  assert.deepEqual(applied,[['h3',false,'command-range'],['h3',false,'command-range']]);
  dismissedSlash.current='/제목';key();assert.equal(applied.length,2);
});

test('paste uses the live typing color for external text and copied notes, including default black', () => {
  const source = fs.readFileSync('src/components/notes/NoteTextEditor.jsx','utf8');
  const paste = source.slice(source.indexOf('  function paste(event)'),source.indexOf('  function copy(event'));
  let activeColor = '#9065b0', inserted = '';
  const context = vm.createContext({loading:false,readOnly:false,selectedFormats:()=>({color:activeColor}),
    setNotice(){},commit:()=>true,escapeHtml,youtubeVideo,webLink,noteHtml,
    document:{execCommand(command,_ui,html){assert.equal(command,'insertHTML');inserted=html;return true;}}});
  vm.runInContext(paste + '\nglobalThis.paste = paste;',context);
  const event = (plain,copied = '') => ({preventDefault(){},clipboardData:{getData:type=>type==='text/plain'?plain:copied}});
  context.paste(event('첫 줄\n<본문>'));
  assert.equal(inserted,'<span style="color:#9065b0">첫 줄<br>&lt;본문&gt;</span>');
  const copied = serializeNoteRuns([{text:'복사한 제목',color:'#337ea9',bold:true,block:'h2'}]);
  context.paste(event('복사한 제목',copied));
  assert.equal(inserted,'<h2><strong><span style="color:#9065b0">복사한 제목</span></strong></h2>');
  activeColor='#0f172a';
  context.paste(event('복사한 제목',copied));
  assert.ok(inserted.includes('color:#0f172a'));
  assert.ok(!inserted.includes('color:#337ea9'));
  context.paste(event('기본색 붙여넣기'));
  assert.equal(inserted,'<span style="color:#0f172a">기본색 붙여넣기</span>');
});

const text=value=>({nodeType:3,nodeName:'#text',data:value});
test('recent text color persists between editors and tolerates unavailable preferences', () => {
  const values = new Map();
  const storage = {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  assert.equal(recentNoteColor(storage),'#0f172a');
  rememberNoteColor('#337ea9',storage);
  assert.equal(recentNoteColor(storage),'#337ea9');
  assert.equal(toggledNoteColor('#0f172a',storage),'#337ea9');
  assert.equal(toggledNoteColor('rgb(51, 126, 169)',storage),'#0f172a');
  assert.equal(toggledNoteColor('#d44c47',storage),'#0f172a');
  assert.equal(toggledNoteColor('#0f172a',storage),'#337ea9');
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

test('native strike tags and inline line-through styles survive editing, copy and explicit removal',()=>{
  for(const tag of ['S','STRIKE','DEL']){
    const stored=readNoteEditor(element('DIV',[element(tag,[text('취소한 문장')])]));
    assert.deepEqual(noteRuns(stored),[{text:'취소한 문장',strike:true}]);
  }
  const root=element('DIV',[element('SPAN',[text('겹친 서식')],{textDecorationLine:'underline line-through'})]);
  assert.deepEqual(noteRuns(readNoteEditor(root)),[{text:'겹친 서식',underline:true,strike:true}]);
  const cleared=readNoteEditor(element('DIV',[element('S',[element('SPAN',[text('해제')],{textDecorationLine:'none'})])]));
  assert.equal(cleared,'해제');
});

test('repeated color shortcuts keep an empty caret typing state while explicit selections still restore', () => {
  const point = {};
  const range = (start = 0,end = start) => ({startContainer:point,startOffset:start,endContainer:point,endOffset:end,
    commonAncestorContainer:point,cloneRange(){return range(this.startOffset,this.endOffset);}});
  let active = range(), pendingColor = '#0f172a', resets = 0, focusCalls = 0;
  const selection = {get rangeCount(){return active ? 1 : 0;},getRangeAt:()=>active,
    removeAllRanges(){active=null;pendingColor='#0f172a';resets++;},addRange(value){active=value;}};
  const editor = {contains:node=>node===point,focus(){focusCalls++;doc.activeElement=editor;},ownerDocument:null};
  const doc = {activeElement:editor,getSelection:()=>selection};editor.ownerDocument=doc;
  const storage = {getItem:()=> '#337ea9'};
  for (const expected of ['#337ea9','#0f172a','#337ea9','#0f172a']) {
    restoreNoteSelection(editor,range());
    pendingColor=toggledNoteColor(pendingColor,storage);
    assert.equal(pendingColor,expected);
  }
  assert.equal(resets,0);
  assert.equal(focusCalls,0);
  active=range(2);
  restoreNoteSelection(editor,range());
  assert.equal(active.startOffset,2);
  assert.equal(resets,0);
  restoreNoteSelection(editor,range(),range(0,3));
  assert.equal(active.startOffset,0);
  assert.equal(active.endOffset,3);
  assert.equal(resets,1);
  active=null;doc.activeElement=null;
  restoreNoteSelection(editor,range(1,2));
  assert.equal(active.startOffset,1);
  assert.equal(active.endOffset,2);
  assert.equal(focusCalls,1);
});

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

test('nested bullet depth, formatting and empty child items survive storage and rendering', () => {
  const root=element('DIV',[element('UL',[
    element('LI',[text('상위'),element('UL',[
      element('LI',[element('B',[text('세부')])]),element('LI',[element('BR')]),
    ])]),element('LI',[text('다음')]),
  ])]);
  const stored=readNoteEditor(root);
  assert.equal(notePlainText(stored),'상위\n세부\n\n다음');
  assert.ok(noteRuns(stored).some(run=>run.text.includes('세부')&&run.listDepth===1&&run.bold));
  assert.equal(noteHtml(stored,true),'<ul><li>상위<ul><li><strong>세부</strong></li><li><br></li></ul></li><li>다음</li></ul>');
  assert.equal(serializeNoteRuns(noteRuns(stored)),stored);
  const emptyParent=element('DIV',[element('UL',[element('LI',[element('UL',[element('LI',[text('하위')])])])])]);
  assert.equal(noteHtml(readNoteEditor(emptyParent),true),'<ul><li><br><ul><li>하위</li></ul></li></ul>');
});

test('checklist completion, empty items, nested lists and formatting survive safe storage', () => {
  const runs=[{text:'진행 중\n',block:'checklist',checked:false,bold:true},
    {text:'완료 항목\n',block:'checklist',checked:true,listDepth:1,color:'#337ea9'},
    {text:'',block:'checklist',checked:false}];
  const stored=serializeNoteRuns(runs);
  assert.deepEqual(noteRuns(stored),runs);
  const html=noteHtml(stored,true);
  assert.equal((html.match(/data-note-checkbox/g)||[]).length,3);
  assert.ok(html.includes('aria-checked="true"'));
  assert.ok(html.includes('<strong>진행 중</strong>'));
  assert.ok(html.includes('color:#337ea9'));
  assert.equal(serializeNoteRuns(noteRuns(stored)),stored);
  const prefix=stored.slice(0,stored.indexOf('['));
  for(const run of [{text:'x',block:'checklist',checked:'true'},{text:'x',block:'bullet',checked:true}]){
    const invalid=prefix+JSON.stringify([run]);assert.equal(notePlainText(invalid),invalid);
  }
  const toggle=createNoteToggle([{text:'제목\n본문',block:'checklist',checked:true,listDepth:1}]);
  assert.deepEqual(toggle.summary,[{text:'제목'}]);
});

test('list levels cannot leak into headings or toggle titles and invalid levels stay literal', () => {
  const toggle=createNoteToggle([{text:'제목\n본문',block:'bullet',listDepth:1}]);
  assert.deepEqual(toggle.summary,[{text:'제목'}]);
  const stored=serializeNoteRuns([{text:'상위\n',block:'bullet'},{text:'하위',block:'bullet',listDepth:1}]);
  const prefix=stored.slice(0,stored.indexOf('['));
  for(const run of [{text:'x',block:'bullet',listDepth:-1},{text:'x',block:'bullet',listDepth:1.5},
    {text:'x',block:'bullet',listDepth:9},{text:'x',block:'h3',listDepth:1}]){
    const invalid=prefix+JSON.stringify([run]);assert.equal(notePlainText(invalid),invalid);
  }
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

test('toggle blocks preserve styled title, rich body and open state through storage and paste', () => {
  const toggle = createNoteToggle([
    {text:'접을 제목\n',bold:true,block:'h2'},
    {text:'본문\n',color:'#337ea9'},
    {text:'항목',block:'bullet'},
  ]);
  assert.deepEqual(toggle.summary,[{text:'접을 제목',bold:true}]);
  assert.equal(toggle.children[0].text,'본문\n');
  const stored = serializeNoteRuns([toggle]);
  assert.deepEqual(noteRuns(stored),[toggle]);
  assert.equal(notePlainText(stored),'접을 제목\n본문\n항목');
  const html = noteHtml(stored,true);
  assert.ok(html.includes('<details class="notes-toggle" open>'));
  assert.ok(html.includes('<strong>접을 제목</strong>'));
  assert.ok(html.includes('<ul><li>항목</li></ul>'));
  assert.ok(html.includes('color:#337ea9'));
  const pasted = noteHtml(stored,false,'#9065b0');
  assert.ok(pasted.includes('color:#9065b0'));
  assert.ok(!pasted.includes('color:#337ea9'));
  toggle.open = false;
  const closed = serializeNoteRuns([toggle]);
  assert.ok(!noteHtml(closed,true).includes('notes-toggle" open'));
  assert.equal(notePlainText(closed),notePlainText(stored));
  assert.equal(serializeNoteRuns(noteRuns(closed)),closed);
});

test('reading collapsed toggle DOM retains hidden body, excludes its arrow and preserves surrounding lines', () => {
  const title = element('SPAN',[element('B',[text('제목')])]);
  const summary = element('SUMMARY',[element('SPAN',[text('▸')]),title]);
  summary.querySelector = () => title;
  const details = element('DETAILS',[summary,element('DIV',[
    element('DIV',[text('내용')]),element('UL',[element('LI',[text('항목')])]),
  ])]);
  details.open = false;
  const stored = readNoteEditor(element('DIV',[element('DIV',[text('앞')]),details,element('DIV',[text('뒤')])]));
  const toggle = noteRuns(stored).find(run=>run.block==='toggle');
  assert.equal(toggle.open,false);
  assert.deepEqual(toggle.summary,[{text:'제목',bold:true}]);
  assert.equal(notePlainText(stored),'앞\n제목\n내용\n항목\n뒤');
  assert.ok(noteHtml(stored,true).includes('<li>항목</li>'));
  const empty = createNoteToggle([{text:'빈 토글'}]);
  assert.ok(noteHtml(serializeNoteRuns([empty]),true).includes('notes-toggle-body"><div><br></div>'));
});

test('adjacent toggles retain every title and body without newline separator runs', () => {
  const first = createNoteToggle([{text:'첫 제목\n첫 본문',bold:true}]);
  const second = createNoteToggle([{text:'둘째 제목\n둘째 본문',color:'#337ea9'}]);
  second.open = false;
  const stored = serializeNoteRuns([first,second]);
  for (const blockMode of [false,true]) {
    assert.equal(noteHtml(stored,blockMode),noteHtml(serializeNoteRuns([first]),true) + noteHtml(serializeNoteRuns([second]),true));
  }
  const emptyList=serializeNoteRuns([first,{text:'',block:'bullet'}]);
  assert.equal(noteHtml(emptyList,true),noteHtml(serializeNoteRuns([first]),true)+'<ul><li><br></li></ul>');
});

test('nested toggles retain surrounding inline text, headings, dividers and following text', () => {
  const inner = createNoteToggle([{text:'안쪽 제목\n안쪽 본문'}]);
  const outer = createNoteToggle([{text:'바깥 제목'}]);
  outer.children = [
    {text:'앞 본문',bold:true},inner,{text:'뒤 본문',color:'#337ea9'},
    {text:'',block:'divider'},{text:'작은 제목',block:'h3'},
  ];
  const stored = serializeNoteRuns([{text:'토글 앞'},outer,{text:'토글 뒤'}]);
  const html = noteHtml(stored,true);
  assert.ok(html.startsWith('<div>토글 앞</div><details'));
  assert.ok(html.includes('<div class="notes-toggle-body"><div><strong>앞 본문</strong></div><details'));
  assert.ok(html.includes('</details><div><span style="color:#337ea9">뒤 본문</span></div><hr><h3>작은 제목</h3>'));
  assert.ok(html.endsWith('</details><div>토글 뒤</div>'));
  for (const value of ['바깥 제목','안쪽 제목','안쪽 본문']) assert.ok(html.includes(value));
});

test('malformed toggle content stays literal instead of rendering arbitrary markup', () => {
  const stored = serializeNoteRuns([createNoteToggle([{text:'제목'}])]);
  const prefix = stored.slice(0,stored.indexOf('['));
  const invalid = prefix+JSON.stringify([{text:'',block:'toggle',summary:[{text:'위험',html:'<script>bad()</script>'}],children:[],open:true}]);
  assert.equal(notePlainText(invalid),invalid);
  assert.ok(!noteHtml(invalid).includes('<script>'));
});

test('selected text drag preserves formatting and accepts destinations inside toggle bodies', () => {
  const sourceText = text('선택한 텍스트');
  const marked = element('EM',[sourceText],{color:'#9065b0'});
  const bodyText = text('토글 본문');
  const body = element('DIV',[bodyText]);
  const root = element('DIV',[marked,element('DETAILS',[element('SUMMARY',[text('제목')]),body])]);
  root.contains = node => {for(let current=node;current;current=current.parentNode) if(current===root) return true;return false;};
  const range = {commonAncestorContainer:sourceText,cloneContents:()=>element('FRAGMENT',[text('텍스트')]),
    cloneRange(){return this;},comparePoint:(node,offset)=>node===sourceText && offset>=3 && offset<=6?0:1};
  let selected=true,point=bodyText;
  root.ownerDocument={getSelection:()=>({rangeCount:1,isCollapsed:!selected,getRangeAt:()=>range}),
    caretRangeFromPoint:()=>({startContainer:point,startOffset:4})};
  const values = new Map();let prevented=false;
  const event = {clientX:50,clientY:100,preventDefault(){prevented=true;},
    dataTransfer:{setData:(type,value)=>values.set(type,value)}};
  const drag=startNoteTextDrag(root,event);
  assert.ok(drag);
  assert.equal(prevented,false);
  assert.equal(event.dataTransfer.effectAllowed,'move');
  assert.equal(values.get('text/plain'),'텍스트');
  assert.deepEqual(noteRuns(values.get('application/x-planer-note')),[{text:'텍스트',italic:true,color:'#9065b0'}]);
  assert.ok(values.get('text/html').includes('color:#9065b0'));
  assert.equal(noteTextDropAllowed(root,drag,event),true);
  point=sourceText;
  assert.equal(noteTextDropAllowed(root,drag,event),false);
  point=text('다른 메모');
  assert.equal(noteTextDropAllowed(root,drag,event),false);
  assert.equal(noteTextDropAllowed(root,null,event),false);
  selected=false;
  assert.equal(startNoteTextDrag(root,event),null);
  assert.equal(prevented,true);
});
