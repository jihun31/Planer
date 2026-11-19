import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {noteRuns,noteHtml,notePlainText,serializeNoteRuns,createNoteToggle} from '../src/features/notes/noteRichText.mjs';
import {readNoteEditor} from '../src/features/notes/noteEditorDom.mjs';
import {decodeNoteImages,noteImageWidth,validNoteImageId} from '../src/features/notes/noteImages.mjs';

const require = createRequire(import.meta.url);
const {registerNoteImages} = require('../electron/note-image-store.cjs');
const PREFIX = '\u001eplaner-note:1:';
const id = '0f8c2a3e-1b2c-4d5e-8f90-123456789abc', other = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';

test('photos are stored as text tokens that older installations can still read', () => {
  const stored = serializeNoteRuns([{text:'앞 '},{text:'',imageId:id,imageWidth:320},{text:' 뒤'}]);
  assert.ok(stored.startsWith(PREFIX));
  const json = JSON.parse(stored.slice(PREFIX.length));
  assert.ok(json.every(run => !('imageId' in run) && !('imageWidth' in run)),'Stored runs must keep the old schema');
  assert.equal(json[1].text,`[사진:${id}:320]`);
  assert.deepEqual(noteRuns(stored),[{text:'앞 '},{text:'',imageId:id,imageWidth:320},{text:' 뒤'}]);
  assert.equal(notePlainText(stored),'앞 [사진] 뒤');
});

test('a note saved by the installed app with a photo token decodes to the same photo', () => {
  const saved = PREFIX + JSON.stringify([{text:`[사진:${id}]`},{text:'메모',bold:true}]);
  assert.deepEqual(noteRuns(saved),[{text:'',imageId:id},{text:'메모',bold:true}]);
  assert.deepEqual(noteRuns(`plain [사진:${id}:48] text`),[{text:'plain '},{text:'',imageId:id,imageWidth:48},{text:' text'}]);
  const inToggle = PREFIX + JSON.stringify([{text:'',block:'toggle',open:true,summary:[{text:'제목'}],children:[{text:`[사진:${other}]`}]}]);
  assert.deepEqual(noteRuns(inToggle)[0].children,[{text:'',imageId:other}]);
});

test('invalid photo ids, widths and links are left as plain text', () => {
  assert.equal(validNoteImageId('not-a-uuid'),false);
  assert.equal(noteImageWidth(0),null);assert.equal(noteImageWidth(9000),null);assert.equal(noteImageWidth('120'),120);
  assert.deepEqual(decodeNoteImages([{text:'[사진:zzzz]'}]),[{text:'[사진:zzzz]'}]);
  assert.deepEqual(decodeNoteImages([{text:`[사진:${id}]`,url:'https://example.com'}]),[{text:`[사진:${id}]`,url:'https://example.com'}]);
  assert.equal(serializeNoteRuns([{text:'',imageId:'bad'}]),'');
  assert.deepEqual(noteRuns(serializeNoteRuns([{text:'',imageId:id,imageWidth:99999}])),[{text:'',imageId:id}]);
});

test('text after a photo is never merged into the photo run', () => {
  const runs = noteRuns(serializeNoteRuns([{text:'',imageId:id},{text:'a'},{text:'b'}]));
  assert.deepEqual(runs,[{text:'',imageId:id},{text:'ab'}]);
});

test('photos render as a placeholder button and are read back from the editor', () => {
  const html = noteHtml(serializeNoteRuns([{text:'',imageId:id,imageWidth:200}]),true);
  assert.match(html,new RegExp(`data-note-image-id="${id}"`));
  assert.match(html,/data-note-image-width="200" style="--note-image-width:200px"/);
  assert.match(html,/contenteditable="false"/);
  const image = {nodeType:1,nodeName:'BUTTON',childNodes:[],dataset:{noteImageId:id,noteImageWidth:'200'},
    matches:selector => selector === '[data-note-image-id]',getAttribute:() => null};
  const text = value => ({nodeType:3,nodeName:'#text',data:value});
  const root = {nodeType:1,nodeName:'DIV',childNodes:[text('앞'),image,text('뒤')],style:{},matches:() => false};
  root.firstChild = root.childNodes[0];
  assert.deepEqual(noteRuns(readNoteEditor(root)),[{text:'앞'},{text:'',imageId:id,imageWidth:200},{text:'뒤'}]);
  assert.deepEqual(createNoteToggle([{text:'',imageId:id}]).summary,[{text:'',imageId:id}]);
});

test('the desktop store saves only real images for the main window and reads them back', async () => {
  const handlers = {}, directory = fs.mkdtempSync(path.join(os.tmpdir(),'planer-note-images-'));
  registerNoteImages({handle:(channel,handler) => {handlers[channel] = handler;}},event => event.main,() => directory);
  const main = {main:true}, png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]).buffer;
  try {
    assert.deepEqual(await handlers['notes:image-save']({main:false},png),{ok:false,code:'forbidden'});
    assert.deepEqual(await handlers['notes:image-save'](main,new TextEncoder().encode('not an image').buffer),{ok:false,code:'format'});
    assert.deepEqual(await handlers['notes:image-save'](main,new ArrayBuffer(0)),{ok:false,code:'format'});
    const saved = await handlers['notes:image-save'](main,png);
    assert.equal(saved.ok,true);assert.ok(validNoteImageId(saved.id));
    const read = await handlers['notes:image-read'](main,saved.id);
    assert.equal(read.src,'data:image/png;base64,' + Buffer.from(png).toString('base64'));
    assert.deepEqual(await handlers['notes:image-read'](main,'../escape'),{ok:false});
    assert.deepEqual(await handlers['notes:image-read']({main:false},saved.id),{ok:false});
    assert.deepEqual(await handlers['notes:image-read'](main,other),{ok:false});
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
