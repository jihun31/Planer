import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {UI_COPY,copyValues,copyEdits} from '../src/features/copy/uiCopy.mjs';
const {createUiTextStore} = createRequire(import.meta.url)('../electron/ui-text-store.cjs');

test('local text edits survive reopening and concurrent settings/guide saves preserve both sections',async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'planer-copy-test-'));
  try {
    const filename = path.join(directory,'nested','ui-text-edits.json');
    const store = createUiTextStore(filename);
    assert.deepEqual(await store.read(),{version:1,sections:{}});
    const settings = copyEdits('settings',{...UI_COPY.settings,timerHeading:'내 타이머'});
    const guide = copyEdits('guide',{...UI_COPY.guide,planner:'학습 내용을 정리합니다.\n다음 줄'});
    await Promise.all([store.save('settings',settings),store.save('guide',guide)]);
    const data = await createUiTextStore(filename).read();
    assert.equal(copyValues('settings',data).timerHeading,'내 타이머');
    assert.equal(copyValues('guide',data).planner,'학습 내용을 정리합니다.\n다음 줄');
    assert.equal(copyValues('settings',data).calendarHeading,UI_COPY.settings.calendarHeading);
    assert.equal(data.sections.settings.items.timerHeading.original,'타이머');
    await assert.rejects(store.save('../outside',settings));
    await assert.rejects(store.save('guide',{title:{original:'기존',text:'x'.repeat(5001)}}));
    assert.equal((await store.read()).sections.guide.items.planner.text,guide.planner.text);
    await store.save('settings',{});
    assert.equal(copyValues('settings',await store.read()).timerHeading,'타이머');
    assert.equal(copyValues('guide',await store.read()).planner,guide.planner.text);
  } finally {await fs.rm(directory,{recursive:true,force:true});}
});

test('malformed local edit files are not overwritten on a failed save',async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'planer-copy-test-'));
  try {
    const filename = path.join(directory,'ui-text-edits.json');
    await fs.writeFile(filename,'not-json');
    await assert.rejects(createUiTextStore(filename).save('guide',{}));
    assert.equal(await fs.readFile(filename,'utf8'),'not-json');
  } finally {await fs.rm(directory,{recursive:true,force:true});}
});
