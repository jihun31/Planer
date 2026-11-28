import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resizeNoteImage } from '../src/features/notes/noteImages.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createListenerRegistry() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn, capture = false) {
      const key = `${type}:${Boolean(capture)}`;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(fn);
    },
    removeEventListener(type, fn, capture = false) {
      const key = `${type}:${Boolean(capture)}`;
      listeners.get(key)?.delete(fn);
    },
    count(type, capture = false) {
      return listeners.get(`${type}:${Boolean(capture)}`)?.size ?? 0;
    },
    dispatch(type, event, capture = false) {
      const key = `${type}:${Boolean(capture)}`;
      for (const fn of [...(listeners.get(key) || [])]) fn(event);
    },
  };
}

function createResizeHarness({ startWidth = 200, originalStyle = '200px' } = {}) {
  const doc = createListenerRegistry();
  const win = createListenerRegistry();
  doc.defaultView = win;

  const classes = new Set();
  const styles = new Map();
  if (originalStyle) styles.set('--note-image-width', originalStyle);
  const imageListeners = createListenerRegistry();

  let capturedPointer = null;
  const image = {
    ownerDocument: doc,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      has: name => classes.has(name),
    },
    style: {
      getPropertyValue: prop => styles.get(prop) || '',
      setProperty: (prop, value) => styles.set(prop, value),
      removeProperty: prop => styles.delete(prop),
    },
    getBoundingClientRect: () => ({ left: 10, width: startWidth }),
    addEventListener: imageListeners.addEventListener,
    removeEventListener: imageListeners.removeEventListener,
  };

  const handle = {
    closest: selector => (selector === '.notes-image-resize' ? handle : selector === '[data-note-image-id]' ? image : null),
    setPointerCapture: id => { capturedPointer = id; },
    hasPointerCapture: id => capturedPointer === id,
    releasePointerCapture: id => { if (capturedPointer === id) capturedPointer = null; },
  };

  const editor = {
    clientLeft: 0,
    clientWidth: 600,
    getBoundingClientRect: () => ({ left: 0 }),
    contains: node => node === image,
  };

  const prevGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ paddingRight: '0px' });

  return {
    doc,
    win,
    image,
    handle,
    editor,
    imageListeners,
    hasCapture: () => capturedPointer !== null,
    restore() {
      globalThis.getComputedStyle = prevGetComputedStyle;
    },
  };
}

test('resizeNoteImage returns a cleanup function that removes all listeners when aborted mid-resize', () => {
  const harness = createResizeHarness();
  try {
    let committed = null;
    const cleanup = resizeNoteImage(
      { target: harness.handle, button: 0, isPrimary: true, pointerId: 7, clientX: 210, preventDefault() {} },
      harness.editor,
      (img, width) => { committed = { img, width }; },
    );

    assert.equal(typeof cleanup, 'function');
    assert.equal(harness.doc.count('pointermove', true), 1);
    assert.equal(harness.doc.count('pointerup', true), 1);
    assert.equal(harness.doc.count('pointercancel', true), 1);
    assert.equal(harness.win.count('blur', false), 1);
    assert.equal(harness.imageListeners.count('click', true), 1);
    assert.equal(harness.image.classList.has('is-resizing'), true);
    assert.equal(harness.hasCapture(), true);

    harness.doc.dispatch('pointermove', { pointerId: 7, buttons: 1, clientX: 260 }, true);
    assert.equal(harness.image.style.getPropertyValue('--note-image-width'), '250px');

    // Simulate unmount/abort before pointerup.
    cleanup();
    cleanup(); // idempotent

    assert.equal(harness.doc.count('pointermove', true), 0);
    assert.equal(harness.doc.count('pointerup', true), 0);
    assert.equal(harness.doc.count('pointercancel', true), 0);
    assert.equal(harness.win.count('blur', false), 0);
    assert.equal(harness.imageListeners.count('click', true), 0);
    assert.equal(harness.image.classList.has('is-resizing'), false);
    assert.equal(harness.hasCapture(), false);
    assert.equal(harness.image.style.getPropertyValue('--note-image-width'), '200px');
    assert.equal(committed, null);
  } finally {
    harness.restore();
  }
});

test('resizeNoteImage commits on pointerup and cleans up listeners safely', () => {
  const harness = createResizeHarness({ startWidth: 200, originalStyle: '' });
  try {
    let committedWidth = null;
    const cleanup = resizeNoteImage(
      { target: harness.handle, button: 0, isPrimary: true, pointerId: 3, clientX: 200, preventDefault() {} },
      harness.editor,
      (_img, width) => { committedWidth = width; },
    );

    harness.doc.dispatch('pointerup', { type: 'pointerup', pointerId: 3, clientX: 280 }, true);

    assert.equal(committedWidth, 280);
    assert.equal(harness.doc.count('pointermove', true), 0);
    assert.equal(harness.doc.count('pointerup', true), 0);
    assert.equal(harness.doc.count('pointercancel', true), 0);
    assert.equal(harness.win.count('blur', false), 0);
    assert.equal(harness.hasCapture(), false);

    // Calling returned cleanup after normal completion is a safe no-op.
    assert.doesNotThrow(() => cleanup());
  } finally {
    harness.restore();
  }
});

test('resizeNoteImage ignores non-primary or non-left pointer events', () => {
  const harness = createResizeHarness();
  try {
    const result = resizeNoteImage(
      { target: harness.handle, button: 2, isPrimary: true, pointerId: 1, clientX: 100, preventDefault() {} },
      harness.editor,
      () => {},
    );
    assert.equal(result, undefined);
    assert.equal(harness.doc.count('pointermove', true), 0);
  } finally {
    harness.restore();
  }
});

test('performance guards remain wired in NotesWorkspace, NoteTextEditor, grids, and LearningTab', () => {
  const read = rel => fs.readFileSync(path.join(rootDir, rel), 'utf8');

  const workspace = read('src/components/notes/NotesWorkspace.jsx');
  assert.match(workspace, /MAX_MOUNTED_NOTES\s*=\s*5/);
  assert.match(workspace, /NoteEditorActiveProvider/);

  const editor = read('src/components/notes/NoteTextEditor.jsx');
  assert.match(editor, /MAX_UNDO_HISTORY\s*=\s*100/);
  assert.match(editor, /if\s*\(!isActive\)\s*return;/);
  assert.match(editor, /imageResizeCleanup\.current\?\.\(\)/);

  const daily = read('src/components/planner/DailySchedule.jsx');
  assert.match(daily, /const\s+labelPlacements\s*=\s*useMemo\(/);
  assert.match(daily, /const\s+ownBlockStarts\s*=\s*useMemo\(/);

  const dayPlan = read('src/components/today/DayPlanGrid.jsx');
  assert.match(dayPlan, /const\s+cellPlans\s*=\s*useMemo\(/);
  assert.match(dayPlan, /const\s+labelPlacements\s*=\s*useMemo\(/);
  assert.match(dayPlan, /selection\?\.pending\s*\?\s*\(\)\s*=>\s*setHovered\(minute\)\s*:\s*undefined/);

  const learning = read('src/components/tabs/LearningTab.jsx');
  assert.match(learning, /const\s+customBlocks\s*=\s*useMemo\(/);
  assert.match(learning, /const\s+preview\s*=\s*useMemo\(/);
});
