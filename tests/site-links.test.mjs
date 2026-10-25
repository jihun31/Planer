import test from 'node:test';
import assert from 'node:assert/strict';
import {webLink,siteLinkHtml,loadSiteInfo} from '../src/features/notes/siteLinks.mjs';
import {noteRuns,noteHtml,serializeNoteRuns} from '../src/features/notes/noteRichText.mjs';
import {readNoteEditor} from '../src/features/notes/noteEditorDom.mjs';
import preview from '../electron/link-preview.cjs';

test('website links render icon, site and escaped title and survive note storage', () => {
  const run = {text:'페이지 <제목>',url:'https://github.com/jihun31/Planer',author:'GitHub',icon:'https://github.githubassets.com/favicons/favicon.svg'};
  const stored = serializeNoteRuns([{text:'이전 줄\n'},run,{text:'\n다음 줄'}]);
  assert.deepEqual(noteRuns(stored),[{text:'이전 줄\n'},run,{text:'\n다음 줄'}]);
  const html = noteHtml(stored,true);
  assert.ok(html.includes('notes-site-icon'));
  assert.ok(html.includes('페이지 &lt;제목&gt;'));
  assert.ok(html.includes('>GitHub</span>'));
  assert.ok(html.includes('referrerpolicy="no-referrer"'));
  assert.ok(!html.includes('<제목>'));
  assert.equal(serializeNoteRuns(noteRuns(stored)),stored);
});

test('website DOM copy and save retain metadata independently of the icon load state', () => {
  const url = 'https://github.com/jihun31/Planer';
  const icon = 'https://github.githubassets.com/favicons/favicon.svg';
  let iconLoaded = true;
  const anchor = {nodeType:1,nodeName:'A',getAttribute:()=>url,querySelector:selector =>
    selector.includes('.notes-link-title') ? {textContent:'Planer'}
      : selector.includes('.notes-link-site') ? {textContent:'GitHub'}
      : iconLoaded ? {getAttribute:()=>icon} : null};
  const root = {nodeType:1,nodeName:'DIV',childNodes:[anchor],firstChild:anchor};
  assert.deepEqual(noteRuns(readNoteEditor(root)),[{text:'Planer',url,author:'GitHub',icon}]);
  iconLoaded = false;
  assert.deepEqual(noteRuns(readNoteEditor(root)),[{text:'Planer',url,author:'GitHub'}]);
});

test('invalid protocols and local destinations remain literal instead of embedded links', async () => {
  for (const url of ['javascript:alert(1)','file:///C:/secret','http://localhost/a','http://127.0.0.1/a','http://192.168.1.1/','https://user:pass@example.com']) {
    assert.equal(webLink(url),null);
    assert.ok(!siteLinkHtml('제목',url).includes('<a'));
    await assert.rejects(preview.loadLinkPreview(url));
  }
});

test('metadata uses Open Graph title and site with relative favicon and decodes entities', () => {
  const html = `<head><script>const x = '<meta property="og:title" content="fake">';</script>
    <title>기본 제목</title><meta content="Valley AI" property="og:site_name">
    <meta property='og:title' content='젠슨 황 &#xD68C;의 &amp; AI'>
    <link rel="apple-touch-icon" href="/apple.png"><link href="/assets/favicon.svg?a=1&amp;b=2" rel="icon"></head>`;
  assert.deepEqual(preview.extractMetadata(html,'https://example.com/article'),{
    title:'젠슨 황 회의 & AI',author:'Valley AI',icon:'https://example.com/assets/favicon.svg?a=1&b=2',
  });
  assert.deepEqual(preview.extractMetadata('<title>OSS</title>','https://example.com/path'),{
    title:'OSS',author:'example.com',icon:'https://example.com/favicon.ico',
  });
});

test('page redirects are resolved and local redirects are rejected before fetching', async () => {
  const requests = [];
  const result = await preview.loadLinkPreview('https://example.com/start',async url => {
    requests.push(url.href);
    return requests.length === 1 ? {location:'/article'} : {html:'<title>공개 글</title><link rel="icon" href="icons/site.png">'};
  });
  assert.deepEqual(requests,['https://example.com/start','https://example.com/article']);
  assert.equal(result.icon,'https://example.com/icons/site.png');
  let count = 0;
  await assert.rejects(preview.loadLinkPreview('https://example.com/',async()=>{count++;return {location:'http://127.0.0.1/admin'};}));
  assert.equal(count,1);
});

test('renderer caches successful desktop previews and retries temporary failures', async () => {
  const original = globalThis.window;
  let count = 0;
  globalThis.window = {electronAPI:{getLinkPreview:async()=>{
    count++;
    return count === 1 ? {ok:false} : {ok:true,title:'페이지 제목',author:'사이트',icon:'https://example.com/icon.png'};
  }}};
  try {
    await assert.rejects(loadSiteInfo('https://example.com/cache-test'));
    assert.equal((await loadSiteInfo('https://example.com/cache-test')).title,'페이지 제목');
    await loadSiteInfo('https://example.com/cache-test');
    assert.equal(count,2);
  } finally {globalThis.window=original;}
});
