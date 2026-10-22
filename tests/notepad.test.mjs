import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotepadStore, MAX_NOTE_LENGTH } from '../src/features/notes/notepadStore.mjs';

function fixture({ uid = 'alice', storage = new Map(), remote = {text:'',revision:0}, save } = {}) {
  let receiver, failure;
  const writes = [];
  const disk = {getItem:key => storage.get(key),setItem:(key,value) => storage.set(key,value),removeItem:key => storage.delete(key)};
  const store = createNotepadStore({uid,storage:disk,delay:60000,
    subscribe:(_uid,onData,onError) => { receiver = onData; failure = onError; onData(remote); return () => {}; },
    save:async (owner,text,revision) => {
      writes.push({uid:owner,text,revision});
      if (save) return save(owner,text,revision);
      remote = {text,revision:revision+1}; receiver(remote); return remote.revision;
    },
  });
  return {store,storage,writes,start:() => store.start(),receive:value => receiver(value),fail:error => failure(error)};
}

test('typing is backed up immediately and one save coalesces the latest text including line breaks', async t => {
  const f = fixture(); t.after(f.start());
  f.store.edit('첫 문장'); f.store.edit('첫 문장\n두 번째 문장');
  assert.equal(f.writes.length,0);
  assert.equal(JSON.parse(f.storage.get('planer:notepad-draft:alice')).text,'첫 문장\n두 번째 문장');
  await f.store.flush();
  assert.deepEqual(f.writes,[{uid:'alice',text:'첫 문장\n두 번째 문장',revision:0}]);
  assert.equal(f.store.getSnapshot().dirty,false);
  assert.equal(f.storage.size,0);
});

test('editing during a slow save retains the newer draft and saves it at the next revision', async t => {
  let finish;
  const f = fixture({save:(_uid,_text,revision) => new Promise(resolve => {finish = () => resolve(revision+1);})});
  t.after(f.start()); f.store.edit('처음');
  const pending = f.store.flush(); f.store.edit('나중 입력'); finish(); await pending;
  assert.equal(f.store.getSnapshot().text,'나중 입력');
  assert.equal(f.store.getSnapshot().dirty,true);
  assert.equal(JSON.parse(f.storage.get('planer:notepad-draft:alice')).revision,1);
  const next = f.store.flush(); finish(); await next;
  assert.deepEqual(f.writes.map(item => [item.text,item.revision]),[['처음',0],['나중 입력',1]]);
  assert.equal(f.store.getSnapshot().dirty,false);
});

test('drafts survive closing and reopening, and never appear in another account', async t => {
  const first = fixture(); const close = first.start(); first.store.edit('보관할 내용'); close();
  const second = fixture({storage:first.storage}); t.after(second.start());
  assert.equal(second.store.getSnapshot().text,'보관할 내용');
  const bob = fixture({uid:'bob',storage:first.storage}); t.after(bob.start());
  assert.equal(bob.store.getSnapshot().text,'');
  await second.store.flush();
  assert.equal(second.writes[0].text,'보관할 내용');
});

test('a changed remote note pauses saving until the user chooses a version', async t => {
  const f = fixture({remote:{text:'원본',revision:2}}); t.after(f.start()); f.store.edit('내 편집');
  f.receive({text:'다른 창 편집',revision:3}); await f.store.flush();
  assert.equal(f.writes.length,0);
  assert.equal(f.store.getSnapshot().text,'내 편집');
  assert.equal(f.store.getSnapshot().conflict.text,'다른 창 편집');
  await f.store.resolveConflict(true);
  assert.equal(f.writes[0].revision,3);
  f.store.edit('또 편집'); f.receive({text:'다른 창의 최신 내용',revision:5});
  f.store.resolveConflict(false);
  assert.equal(f.store.getSnapshot().text,'다른 창의 최신 내용');
  assert.equal(f.store.getSnapshot().dirty,false);
});

test('permission failures retain drafts; retry recovers after rules are applied', async t => {
  let denied = true;
  const f = fixture({save:async (_uid,_text,revision) => {
    if (denied) throw Object.assign(new Error('denied'),{code:'permission-denied'});
    return revision+1;
  }});
  t.after(f.start()); f.store.edit('잃으면 안 되는 내용'); await f.store.flush();
  assert.equal(f.store.getSnapshot().error.code,'permission-denied');
  assert.ok(f.storage.get('planer:notepad-draft:alice'));
  denied = false; f.store.retry(); await f.store.flush();
  assert.equal(f.store.getSnapshot().dirty,false);
  assert.equal(f.store.getSnapshot().error,null);
});

test('a local draft with a newer revision than the server becomes a recoverable conflict', t => {
  const storage = new Map([['planer:notepad-draft:alice',JSON.stringify({text:'남은 초안',revision:4})]]);
  const f = fixture({storage}); t.after(f.start());
  assert.equal(f.store.getSnapshot().loading,false);
  assert.equal(f.store.getSnapshot().text,'남은 초안');
  assert.equal(f.store.getSnapshot().conflict.revision,0);
});

test('notes can be cleared, reject oversized input, and flag local backup failure', async t => {
  const f = fixture({remote:{text:'지울 메모',revision:1}}); t.after(f.start());
  f.store.edit(''); await f.store.flush(); assert.equal(f.writes[0].text,'');
  f.store.edit('x'.repeat(MAX_NOTE_LENGTH+1)); assert.equal(f.store.getSnapshot().text,'');
  const broken = createNotepadStore({uid:'alice',subscribe:(_uid,onData) => {onData({text:'',revision:0}); return () => {};},
    save:async () => 1,delay:60000,storage:{getItem:() => null,setItem:() => {throw Error('disk full');},removeItem() {}}});
  t.after(broken.start()); broken.edit('보관 실패');
  assert.equal(broken.getSnapshot().localError,true);
});

test('deletion stops queued and late saves and removes the local draft', async t => {
  let finish;
  const f = fixture({save:() => new Promise(resolve => {finish = resolve;})});
  t.after(f.start());f.store.edit('삭제할 내용');
  const saving = f.store.flush();
  await f.store.remove(async () => {});
  finish(1);await saving;
  f.store.edit('삭제 후 입력');await f.store.flush();
  assert.equal(f.store.getSnapshot().deleted,true);
  assert.equal(f.store.getSnapshot().text,'');
  assert.equal(f.storage.size,0);
  assert.equal(f.writes.length,1);
});

test('a failed deletion preserves the draft; remote deletion clears it without recreating a note', async t => {
  const f = fixture();t.after(f.start());f.store.edit('보존할 내용');
  await assert.rejects(f.store.remove(async () => {throw Error('permission denied');}));
  assert.equal(f.store.getSnapshot().text,'보존할 내용');
  assert.ok(f.storage.size);
  f.receive({text:'',revision:1,deleted:true});await f.store.flush();
  assert.equal(f.store.getSnapshot().deleted,true);
  assert.equal(f.storage.size,0);
  assert.equal(f.writes.length,0);
});
