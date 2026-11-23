import { MAX_NOTE_LIST_DEPTH } from './noteRichText.mjs';
import { removeNoteListRow } from './noteEditorDom.mjs';
import { decorateNoteChecklistItem, undecorateNoteChecklistItem } from './noteChecklistEditing.mjs';

const FOLLOWING = 4;
const nestedList = item => item.querySelector(':scope > ul, :scope > ol');

function closestItem(editor,node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  const item = element?.closest('li');
  return item && editor.contains(item) && ['UL','OL'].includes(item.parentElement?.nodeName) ? item : null;
}

function keepRange(editor,selection,change) {
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const endpoints = range && [range.startContainer,range.startOffset,range.endContainer,range.endOffset];
  const result = change();
  if (endpoints && editor.contains(endpoints[0]) && editor.contains(endpoints[2])) {
    const limit = node => node.nodeType === 3 ? node.length : node.childNodes.length;
    const next = editor.ownerDocument.createRange();
    next.setStart(endpoints[0],Math.min(endpoints[1],limit(endpoints[0])));
    next.setEnd(endpoints[2],Math.min(endpoints[3],limit(endpoints[2])));
    selection.removeAllRanges();selection.addRange(next);
  }
  return result;
}

// The selected rows of one list: the caret's row, or every sibling row from the
// selection start to the row (or ancestor row) that holds the selection end.
function selectedSiblings(editor,range) {
  const first = closestItem(editor,range.startContainer);
  if (!first) return [];
  let last = closestItem(editor,range.endContainer) || first;
  while (last && last.parentElement !== first.parentElement) last = last.parentElement?.closest('li');
  if (!last || !editor.contains(last) || (last !== first && !(first.compareDocumentPosition(last) & FOLLOWING))) last = first;
  const items = [];
  for (let item = first; item; item = item.nextElementSibling) {items.push(item);if (item === last) break;}
  return items;
}

// Alt+Shift+Up/Down: swap the selected rows (with their sub-items) and the
// neighbouring row. Moving the neighbour keeps the caret's nodes in place.
export function moveNoteListItems(editor,selection,up) {
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;
  const items = selectedSiblings(editor,range);
  if (!items.length) return false;
  const neighbour = up ? items[0].previousElementSibling : items.at(-1).nextElementSibling;
  if (!neighbour) return true;
  if (up) items.at(-1).after(neighbour);
  else items[0].before(neighbour);
  return true;
}

function listDepth(editor,item) {
  let depth = -1;
  for (let node = item; node && node !== editor && node.nodeName !== 'DETAILS'; node = node.parentElement) {
    if (['UL','OL'].includes(node.nodeName)) depth++;
  }
  return Math.max(0,depth);
}

function subtreeDepth(item) {
  let deepest = 0;
  for (const child of item.querySelectorAll('li')) {
    let depth = 0;
    for (let node = child; node && node !== item; node = node.parentElement) if (['UL','OL'].includes(node.nodeName)) depth++;
    deepest = Math.max(deepest,depth);
  }
  return deepest;
}

// The row's own line, without its nested sub-list.
function ownRect(item) {
  const rect = item.getBoundingClientRect(), nested = nestedList(item);
  const bottom = nested ? nested.getBoundingClientRect().top : rect.bottom;
  return {left:rect.left,right:rect.right,top:rect.top,bottom:Math.max(rect.top + 1,bottom)};
}

export function noteListItemHandleRect(item) {
  return ownRect(item);
}

// The list row whose own line is at this height (a sub-item, not its parent row).
export function noteListItemAtPoint(editor,y,exclude = null) {
  let found = null;
  for (const item of editor.querySelectorAll('li')) {
    if (exclude?.contains(item) || item.matches('[data-note-list-text="continuation"]')) continue;
    if (!['UL','OL'].includes(item.parentElement?.nodeName) || !item.getClientRects().length) continue;
    const rect = ownRect(item);
    if (y >= rect.top && y < rect.bottom) found = {item,rect};
  }
  return found;
}

// Where a dragged row would land: before or after a row at that row's depth, or
// inside it as its first sub-item (pointer to the right, or the row has sub-items).
export function noteListDropTarget(editor,dragged,x,y) {
  const found = noteListItemAtPoint(editor,y,dragged);
  if (!found) return null;
  const {item,rect} = found, depth = listDepth(editor,item), needed = subtreeDepth(dragged);
  let position = y < (rect.top + rect.bottom) / 2 ? 'before' : nestedList(item) || x > rect.left + 32 ? 'inside' : 'after';
  if (position === 'inside' && depth + 1 + needed > MAX_NOTE_LIST_DEPTH) position = 'after';
  if (depth + needed > MAX_NOTE_LIST_DEPTH) return null;
  const bounds = editor.getBoundingClientRect(), style = editor.ownerDocument.defaultView.getComputedStyle(editor);
  const left = rect.left + (position === 'inside' ? 24 : 0);
  const right = bounds.right - (parseFloat(style.paddingRight) || 0);
  const top = position === 'before' ? rect.top : position === 'inside' ? rect.bottom : item.getBoundingClientRect().bottom;
  if (top < bounds.top || top > bounds.bottom) return null;
  return {target:item,position,indicator:{left,top:top - 1.5,width:Math.max(0,right - left),height:3}};
}

function removeEmptyList(list) {
  if (!list || list.children.length) return;
  const owner = list.parentElement;
  list.remove();
  // A marker-less row that only held the moved row has nothing left to show.
  if (owner?.matches?.('li[data-note-list-text="continuation"]') && !nestedList(owner)) removeNoteListRow(owner);
}

export function moveNoteListItemTo(editor,item,drop) {
  const target = drop?.target;
  if (!target || item.contains(target) || !editor.contains(target)) return false;
  const source = item.parentElement;
  if (drop.position === 'before') {
    if (target.previousElementSibling === item) return false;
    target.before(item);
  } else if (drop.position === 'after') {
    if (target.nextElementSibling === item) return false;
    target.after(item);
  } else {
    let nested = nestedList(target);
    if (nested?.firstElementChild === item) return false;
    if (!nested) {nested = editor.ownerDocument.createElement(source.nodeName.toLowerCase());target.append(nested);}
    nested.prepend(item);
  }
  removeEmptyList(source);
  return true;
}

function selectedRows(editor,range) {
  const start = closestItem(editor,range.startContainer);
  if (!start || !closestItem(editor,range.endContainer)) return [];
  if (range.collapsed) return [start];
  return [...editor.querySelectorAll('li')].filter(item => ['UL','OL'].includes(item.parentElement?.nodeName)
    && [...item.childNodes].some(child => !['UL','OL'].includes(child.nodeName) && range.intersectsNode(child)));
}

// Convert only the selected rows between bullet, numbered and checklist rows,
// keeping their depth, sub-items and text. Returns false outside lists.
export function convertNoteListItems(editor,selection,type) {
  if (!['bullet','numbered','checklist'].includes(type) || !selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;
  const outside = [...editor.querySelectorAll('div,p,h1,h2,h3,blockquote,hr,details')].some(node =>
    !node.contains(range.commonAncestorContainer) && range.intersectsNode(node) && !node.closest('li'));
  if (outside) return false;
  const items = selectedRows(editor,range);
  if (!items.length) return false;
  const tag = type === 'numbered' ? 'OL' : 'UL', doc = editor.ownerDocument;
  keepRange(editor,selection,() => {
    for (const list of new Set(items.map(item => item.parentElement))) {
      const chosen = [...list.children].filter(child => items.includes(child));
      if (!chosen.length || list.nodeName === tag) continue;
      const first = chosen[0], last = chosen.at(-1), moving = [];
      for (let item = first; item; item = item.nextElementSibling) {moving.push(item);if (item === last) break;}
      const tail = list.cloneNode(false);tail.removeAttribute('start');
      while (last.nextElementSibling) tail.append(last.nextElementSibling);
      let target = doc.createElement(tag.toLowerCase());
      list.after(target);target.append(...moving);
      if (tail.children.length) target.after(tail);
      if (!list.children.length) list.remove();
      const previous = target.previousElementSibling, next = target.nextElementSibling;
      if (previous?.nodeName === tag) {previous.append(...target.children);target.remove();target = previous;}
      if (next?.nodeName === tag) {target.append(...next.children);next.remove();}
    }
    for (const item of items) {
      if (item.hasAttribute('data-note-list-text')) continue;
      if (type === 'checklist') decorateNoteChecklistItem(item);
      else undecorateNoteChecklistItem(item);
    }
  });
  return true;
}

// A checked row moves below its siblings; an unchecked row moves back above the
// checked rows at the end of its list.
export function settleNoteChecklistItem(item) {
  const list = item.parentElement;
  if (!list || !['UL','OL'].includes(list.nodeName)) return false;
  if (item.getAttribute('data-note-checked') === 'true') {
    if (!item.nextElementSibling) return false;
    list.append(item);return true;
  }
  const siblings = [...list.children].filter(child => child !== item);
  let tail = siblings.length;
  while (tail > 0 && siblings[tail - 1].getAttribute('data-note-checked') === 'true') tail--;
  const tailStart = siblings[tail];
  if (!tailStart || !(tailStart.compareDocumentPosition(item) & FOLLOWING)) return false;
  tailStart.before(item);return true;
}
