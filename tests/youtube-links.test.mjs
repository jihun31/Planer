import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeVideo, youtubeToken, noteParts, notePlainText, noteHtml, loadYouTubeInfo } from '../src/features/notes/youtubeLinks.mjs';

test('YouTube links accept video formats and reject lookalike hosts and arbitrary URLs', () => {
  for (const url of ['https://youtu.be/jNQXAC9IVRw?si=tracker','https://www.youtube.com/watch?v=jNQXAC9IVRw',
    'https://m.youtube.com/shorts/jNQXAC9IVRw','https://youtube.com/live/jNQXAC9IVRw','https://www.youtube.com/embed/jNQXAC9IVRw']) {
    assert.equal(youtubeVideo(url).url,'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  }
  assert.equal(youtubeVideo('https://youtu.be/jNQXAC9IVRw?t=42').url,'https://www.youtube.com/watch?v=jNQXAC9IVRw&t=42');
  for (const url of ['https://youtube.com.evil.test/watch?v=jNQXAC9IVRw','https://youtube.com@evil.test/watch?v=jNQXAC9IVRw',
    'javascript:alert(1)','https://youtube.com/watch?v=short','https://youtube.com/playlist?list=jNQXAC9IVRw']) assert.equal(youtubeVideo(url),null);
});

test('title links round trip special characters and preserve existing text without interpreting HTML', () => {
  const url = youtubeVideo('https://youtu.be/jNQXAC9IVRw').url;
  const title = '강의 [1] \\ 복습 (오늘) <script> & "영상"';
  const source = `이전 메모\n${youtubeToken(title,url)}\n그대로 유지`;
  assert.deepEqual(noteParts(source),[{text:'이전 메모\n'},{text:title,url},{text:'\n그대로 유지'}]);
  assert.equal(notePlainText(source),`이전 메모\n${title}\n그대로 유지`);
  const html = noteHtml(source);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('target="_blank"'));
  assert.equal(noteHtml('<img src=x onerror=alert(1)>'),'&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(noteHtml('[위험](javascript:alert(1))'),'[위험](javascript:alert(1))');
  assert.equal(notePlainText('원래 메모\n\n  공백\n'),'원래 메모\n\n  공백\n');
  const author = '채널 "이름" \\ <img>';
  const mention = youtubeToken(title,url,author);
  assert.deepEqual(noteParts(mention),[{text:title,url,author}]);
  assert.ok(noteHtml(mention).includes('notes-youtube-icon'));
  assert.ok(noteHtml(mention).includes('&lt;img&gt;'));
  assert.ok(!noteHtml(mention).includes('<img>'));
});

test('title lookups retry failures, use a fixed endpoint, and cache only valid titles', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url,options) => {
    calls++;
    assert.equal(new URL(url).origin,'https://www.youtube.com');
    assert.equal(options.credentials,'omit');
    return {ok:calls > 1,json:async () => ({title:'  강의 제목  ',author_name:' 강의 채널 '})};
  };
  try {
    await assert.rejects(loadYouTubeInfo('https://youtu.be/jNQXAC9IVRw'));
    assert.deepEqual(await loadYouTubeInfo('https://youtu.be/jNQXAC9IVRw'),{title:'강의 제목',author:'강의 채널'});
    assert.deepEqual(await loadYouTubeInfo('https://youtu.be/jNQXAC9IVRw?t=42'),{title:'강의 제목',author:'강의 채널'});
    assert.equal(calls,2);
    await assert.rejects(loadYouTubeInfo('https://evil.example/watch?v=jNQXAC9IVRw'));
    assert.equal(calls,2);
  } finally { globalThis.fetch = original; }
});
