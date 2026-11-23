import { webLink } from './siteLinks.mjs';
import { noteColor, NOTE_TEXT_COLORS, MAX_NOTE_LIST_DEPTH, noteRuns, serializeNoteRuns } from './noteRichText.mjs';
import { noteImageSelector, noteImageWidth, validNoteImageId } from './noteImages.mjs';

export const noteInlineLinkSelector = 'a[href]:not(.notes-site-mention,.notes-youtube-mention)';

function nodeFormat(node,inherited) {
  const format = {...inherited}, style = node.style;
  if (node.matches?.(noteInlineLinkSelector)) {
    const link = webLink(node.getAttribute('href'));
    if (link) {format.url = link.url;format.inlineLink = true;}
  }
  if (['B','STRONG'].includes(node.nodeName)) format.bold = true;
  if (style?.fontWeight) format.bold = style.fontWeight === 'bold' || Number(style.fontWeight) >= 600;
  if (node.nodeName === 'U') format.underline = true;
  if (['S','STRIKE','DEL'].includes(node.nodeName)) format.strike = true;
  if (['I','EM'].includes(node.nodeName)) format.italic = true;
  if (style?.fontStyle) format.italic = style.fontStyle === 'italic' || style.fontStyle === 'oblique';
  const foreground = style?.color || (node.nodeName === 'FONT' ? node.getAttribute('color') : null);
  if (foreground) {
    const color = noteColor(foreground);
    if (color && color !== NOTE_TEXT_COLORS[0].value) format.color = color;
    else delete format.color;
  }
  const blocks = {H1:'h1',H2:'h2',H3:'h3',BLOCKQUOTE:'quote',LI:'bullet'};
  if (blocks[node.nodeName]) format.block = blocks[node.nodeName];
  if (node.nodeName === 'LI') {
    if(node.parentNode?.nodeName==='OL') format.block='numbered';
    if (node.getAttribute?.('data-note-checked') != null) {
      format.block = 'checklist';format.checked = node.getAttribute('data-note-checked') === 'true';
    } else delete format.checked;
    delete format.listNumbered;
    delete format.listContinuation;
    delete format.listStart;
    const listText = node.getAttribute?.('data-note-list-text');
    if (listText) {
      format.block = 'list-text';
      if (node.parentNode?.nodeName === 'OL') format.listNumbered = true;
      if (listText === 'continuation') format.listContinuation = true;
    }
    let lists = 0;
    for (let parent=node.parentNode;parent && parent.nodeName !== 'DETAILS';parent=parent.parentNode) {
      if (['UL','OL'].includes(parent.nodeName)) lists++;
    }
    const start = Number(node.parentNode?.getAttribute?.('start'));
    if (node.parentNode?.nodeName === 'OL' && node.parentNode.firstElementChild === node && start > 1) format.listStart = start;
    if (lists > 1) format.listDepth = Math.min(lists-1,MAX_NOTE_LIST_DEPTH);
    else if (lists === 1) delete format.listDepth;
  }
  if (!['bullet','numbered','checklist','list-text'].includes(format.block)) {
    delete format.listDepth;delete format.checked;delete format.listNumbered;delete format.listContinuation;delete format.listStart;
  }
  const decoration = style?.textDecorationLine || style?.textDecoration;
  if (decoration) {format.underline = decoration.includes('underline');format.strike = decoration.includes('line-through');}
  if (node.nodeName === 'MARK') format.highlight = true;
  if (style?.backgroundColor) format.highlight = ['#fff0a8','rgb(255,240,168)'].includes(style.backgroundColor.replace(/\s/g,'').toLowerCase());
  return format;
}

export function noteFormatAt(node,editor) {
  const ancestors = [];
  for (let current = node; current && current !== editor; current = current.parentNode) ancestors.unshift(current);
  return ancestors.reduce((format,current) => nodeFormat(current,format),{});
}

export function restoreNoteSelection(editor,savedRange,preferredRange) {
  const doc = editor.ownerDocument, selection = doc.getSelection();
  const current = selection.rangeCount ? selection.getRangeAt(0) : null;
  const range = preferredRange || (current && editor.contains(current.commonAncestorContainer) ? current.cloneRange() : savedRange);
  if (doc.activeElement !== editor) editor.focus({preventScroll:true});
  if (range && editor.contains(range.commonAncestorContainer)) {
    const active = selection.rangeCount ? selection.getRangeAt(0) : null;
    // Resetting an unchanged caret clears Chromium's pending typing color on empty lines.
    if (!active || active.startContainer !== range.startContainer || active.startOffset !== range.startOffset
      || active.endContainer !== range.endContainer || active.endOffset !== range.endOffset) {
      selection.removeAllRanges();selection.addRange(range);
    }
  } else {
    const end = doc.createRange();end.selectNodeContents(editor);end.collapse(false);
    selection.removeAllRanges();selection.addRange(end);
  }
  return selection;
}

const noteParagraphSelector = 'div,p,h1,h2,h3,blockquote';
const noteBlockSelector = noteParagraphSelector + ',li,.notes-toggle-title';
const noteLineBoundaries = 'div,p,h1,h2,h3,blockquote,li,ul,ol,details,hr,[data-note-checkbox]';

const listContentSelector = '.notes-checklist-text,[data-note-list-content]';

function noteListContent(item) {
  return item.querySelector(':scope > .notes-checklist-text, :scope > [data-note-list-content]') || item;
}

export function noteRangeHasContent(range) {
  const fragment = range.cloneContents();
  return !!(fragment.textContent.replace(/[\u200b\ufeff]/g,'') || fragment.querySelector('a,img,[data-note-image-id]'));
}

export function noteLine(editor,selection) {
  let node = selection?.focusNode, offset = selection?.focusOffset;
  if (!node || !editor.contains(node)) return null;
  const element = node.nodeType === 1 ? node : node.parentElement;
  let scope = element.closest(noteBlockSelector);
  if (!editor.contains(scope)) scope = editor;
  if (scope.nodeName === 'LI') {
    const content = noteListContent(scope);
    if (node === scope && content !== scope) {
      offset = offset > [...scope.childNodes].indexOf(content) ? content.childNodes.length : 0;
      node = content;
    }
    if (content.contains(node)) scope = content;
  }

  const doc = editor.ownerDocument;
  const range = doc.createRange(), focus = doc.createRange();
  range.selectNodeContents(scope);
  focus.setStart(node,offset);
  focus.collapse(true);
  const boundaries = [];
  function visit(container) {
    [...container.childNodes].forEach((child,index) => {
      if (child.nodeType === 3) {
        for (let at = child.data.indexOf('\n'); at !== -1; at = child.data.indexOf('\n',at + 1)) {
          boundaries.push({node:child,start:at,end:at + 1,kind:'newline'});
        }
      } else if (child.nodeType === 1) {
        if (child.matches('br,' + noteLineBoundaries)) {
          boundaries.push({node:container,start:index,end:index + 1,kind:child.nodeName === 'BR' ? 'br' : 'block'});
        } else if (child.getAttribute('contenteditable') !== 'false') visit(child);
      }
    });
  }
  visit(scope);
  let before = null, after = null, placeholder = null;
  for (const [index,boundary] of boundaries.entries()) {
    const {node,end,kind} = boundary;
    const next = boundaries[index + 1];
    if (kind === 'br' && (!next || next.kind === 'block')) {
      const tail = doc.createRange();
      tail.selectNodeContents(scope);
      tail.setStart(node,end);
      if (next) tail.setEnd(next.node,next.start);
      // A final BR makes the caret visible on a blank line in Chromium.
      if (!noteRangeHasContent(tail)) {placeholder = boundary;continue;}
    }
    if (focus.comparePoint(node,end) <= 0) {
      before = boundary;
      placeholder = null;
    } else {
      after = boundary;
      break;
    }
  }
  if (before) range.setStart(before.node,before.end);
  const end = placeholder || after;
  if (end) range.setEnd(end.node,end.start);
  return {range,scope,before,after,placeholder};
}

export function firstEmptyNoteLine(editor,selection) {
  if (!selection?.isCollapsed || !selection.rangeCount) return null;
  const first = editor.firstChild;
  const plainBlock = first?.matches?.(noteParagraphSelector) ? first : null;
  const atEditorStart = selection.focusNode === editor && selection.focusOffset === 0;
  const line = noteLine(editor,plainBlock && atEditorStart ? {focusNode:plainBlock,focusOffset:0} : selection);
  if (!line || line.before || (line.scope !== editor && line.scope !== plainBlock)
    || (line.after?.kind === 'block' && line.range.collapsed && !line.placeholder)
    || noteRangeHasContent(line.range)) return null;
  return line;
}

export function removeNoteListRow(item) {
  const nested = [...item.children].filter(child => child.matches('ul,ol'));
  if (nested.length) {
    // A hidden list row keeps the existing depth and order of its children.
    const content = item.ownerDocument.createElement('span');
    content.setAttribute('data-note-list-content','');
    content.hidden = true;
    content.append(item.ownerDocument.createElement('br'));
    item.setAttribute('data-note-list-text','continuation');
    item.removeAttribute('data-note-checked');
    item.classList.remove('notes-checklist-item');
    if (!item.className) item.removeAttribute('class');
    item.replaceChildren(content,...nested);
  } else {
    const list = item.parentElement;
    item.remove();
    if (!list.children.length) list.remove();
  }
}

function noteCaretNear(editor,gap) {
  let previous = null;
  for (const row of editor.querySelectorAll(noteBlockSelector)) {
    if (row.matches('[data-note-list-text="continuation"],.notes-toggle-body') || row.closest('[hidden]')) continue;
    if (row.closest('details:not([open])')?.querySelector(':scope > .notes-toggle-body')?.contains(row)) continue;
    const content = row.nodeName === 'LI' ? noteListContent(row) : row;
    const point = editor.ownerDocument.createRange();
    point.selectNodeContents(content);
    if (gap.comparePoint(point.startContainer,point.startOffset) > 0) {
      point.collapse(true);
      return point;
    }
    const nested = content.querySelector(':scope > ul, :scope > ol');
    if (nested && content === row && row.nodeName === 'LI') point.setEndBefore(nested);
    previous = point;
  }
  if (previous) previous.collapse(false);
  return previous || gap;
}

export function removeNoteLine(editor,line,selection) {
  const {range,scope,before,after,placeholder} = line;
  const followingBreak = after && after.kind !== 'block' ? after : null;
  const precedingBreak = before && before.kind !== 'block' ? before : null;
  const separator = followingBreak || precedingBreak;
  const item = scope.nodeName === 'LI' ? scope : scope.matches(listContentSelector) ? scope.parentElement : null;
  const toggle = scope.matches('.notes-toggle-title') && scope.closest('details');
  const wholeBlock = scope !== editor && !scope.matches('.notes-toggle-body') && !before && !after;
  let caret = range.cloneRange();
  if (!separator && (item || toggle || wholeBlock)) {
    const row = item || toggle || scope;
    caret.setStartBefore(row);
    caret.collapse(true);
    if (item) removeNoteListRow(item);
    else if (toggle) {
      const body = toggle.querySelector(':scope > .notes-toggle-body');
      if (body && readNoteEditor(body)) toggle.replaceWith(...body.childNodes);
      else toggle.remove();
    } else row.remove();
    caret = noteCaretNear(editor,caret);
  } else {
    if (separator && separator === before) caret.setStart(before.node,before.start);
    if (separator && separator === after) caret.setEnd(after.node,after.end);
    else if (placeholder) caret.setEnd(placeholder.node,placeholder.end);
    caret.deleteContents();
    caret.collapse(true);
  }
  selection.removeAllRanges();selection.addRange(caret);
}

// Browser-created paragraphs and inline marks are serialized without storing raw HTML.
export function readNoteEditor(root,inherited = {}) {
  const runs = [];
  const append = (text,format,link) => {if (text) runs.push({text,...format,...link});};
  function read(node,parentFormat) {
    if (node.nodeType === 3) {append(node.data,parentFormat);return;}
    if (node.matches?.(noteImageSelector)) {
      const id = node.dataset.noteImageId, width = noteImageWidth(node.dataset.noteImageWidth);
      if (validNoteImageId(id)) runs.push({text:'',...parentFormat,imageId:id,...(width ? {imageWidth:width} : {})});
      return;
    }
    if (node.nodeName === 'BUTTON' && node.getAttribute?.('data-note-checkbox') === 'true') return;
    if (node.nodeName === 'HR') {runs.push({text:'',block:'divider'});return;}
    if (node.nodeName === 'DETAILS') {
      const summary = [...node.childNodes].find(child => child.nodeName === 'SUMMARY');
      const title = summary?.querySelector?.('.notes-toggle-title') || summary;
      const bodyNodes = [...node.childNodes].filter(child => child !== summary);
      const {block:_block,listDepth:_listDepth,checked:_checked,listNumbered:_numbered,listContinuation:_continuation,listStart:_start,...inlineFormat} = parentFormat;
      const summaryRuns = title ? noteRuns(readNoteEditor(title,inlineFormat)).map(({block:_block,listDepth:_listDepth,checked:_checked,listNumbered:_numbered,listContinuation:_continuation,listStart:_start,...run}) => run) : [];
      const body = {nodeName:'DIV',childNodes:bodyNodes,firstChild:bodyNodes[0]};
      runs.push({text:'',block:'toggle',summary:summaryRuns,children:noteRuns(readNoteEditor(body,inlineFormat)),open:node.open !== false});
      return;
    }
    if (node.nodeName === 'A' && !node.matches?.(noteInlineLinkSelector) && webLink(node.getAttribute('href'))) {
      const icon = node.querySelector('.notes-site-icon')?.getAttribute('src');
      append(node.querySelector('.notes-link-title, .notes-youtube-title')?.textContent ?? node.textContent,parentFormat,
        {url:node.getAttribute('href'),author:node.querySelector('.notes-link-site, .notes-youtube-author')?.textContent || '',
          ...(webLink(icon) ? {icon} : {})});return;
    }
    const format = nodeFormat(node,parentFormat);
    if (node.nodeName === 'BR') {
      // The caret slot after a trailing photo is not a saved blank line.
      if (node.hasAttribute?.('data-note-image-caret') && !node.nextSibling) return;
      append('\n',format);return;
    }
    if (!node.childNodes.length || (node.childNodes.length === 1 && node.firstChild.nodeName === 'BR')) {
      if (node.nodeName === 'LI') runs.push({text:'',...format});
      return;
    }
    const children = [...node.childNodes];
    if (node.nodeName === 'LI' && format.block === 'list-text' && !children.some(child =>
      !['UL','OL'].includes(child.nodeName) && (child.textContent || child.matches?.(noteImageSelector) || child.querySelector?.('a,img,[data-note-image-id]')))) {
      runs.push({text:'',...format});
    }
    if (node.nodeName === 'LI' && format.block === 'checklist' && !children.some(child=>
      !['UL','OL'].includes(child.nodeName) && child.getAttribute?.('data-note-checkbox') == null
      && (child.textContent || child.matches?.(noteImageSelector) || child.querySelector?.(noteImageSelector)))) {
      runs.push({text:'',...format});
    }
    if (node.nodeName === 'LI' && ['UL','OL'].includes(children[0]?.nodeName)) {
      runs.push({text:'',...format});append('\n',format);
    }
    const block = child => ['DIV','P','LI','H1','H2','H3','BLOCKQUOTE','UL','OL','HR','DETAILS'].includes(child.nodeName);
    children.forEach((child,index) => {
      if (index && block(child) && !block(children[index - 1]) && children[index - 1].nodeName !== 'BR') append('\n',format);
      read(child,format);
      if (block(child) && index < children.length - 1) append('\n',nodeFormat(child,format));
    });
  }
  read(root,inherited);
  return serializeNoteRuns(runs);
}


// Ctrl+A selects the current line first; a second Ctrl+A (the same selection,
// or a selection that already covers the whole line) selects the whole note.
export function noteLineSelected(editor,selection,previous) {
  if (!selection?.rangeCount) return false;
  const current = selection.getRangeAt(0);
  if (previous && ['startContainer','startOffset','endContainer','endOffset'].every(key => current[key] === previous[key])) return true;
  if (selection.isCollapsed) return false;
  const line = noteLine(editor,selection);
  return !!line && current.compareBoundaryPoints(Range.START_TO_START,line.range) <= 0
    && current.compareBoundaryPoints(Range.END_TO_END,line.range) >= 0;
}

export function selectWholeNote(editor,selection) {
  const range = editor.ownerDocument.createRange();
  range.selectNodeContents(editor);
  selection.removeAllRanges();selection.addRange(range);
}
