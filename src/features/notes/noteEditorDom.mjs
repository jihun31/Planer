import { webLink } from './siteLinks.mjs';
import { noteColor, NOTE_TEXT_COLORS, MAX_NOTE_LIST_DEPTH, noteRuns, serializeNoteRuns } from './noteRichText.mjs';

function nodeFormat(node,inherited) {
  const format = {...inherited}, style = node.style;
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
    let lists = 0;
    for (let parent=node.parentNode;parent && parent.nodeName !== 'DETAILS';parent=parent.parentNode) {
      if (['UL','OL'].includes(parent.nodeName)) lists++;
    }
    if (lists > 1) format.listDepth = Math.min(lists-1,MAX_NOTE_LIST_DEPTH);
    else if (lists === 1) delete format.listDepth;
  }
  if (!['bullet','numbered','checklist'].includes(format.block)) {delete format.listDepth;delete format.checked;}
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

// Browser-created paragraphs and inline marks are serialized without storing raw HTML.
export function readNoteEditor(root,inherited = {}) {
  const runs = [];
  const append = (text,format,link) => {if (text) runs.push({text,...format,...link});};
  function read(node,parentFormat) {
    if (node.nodeType === 3) {append(node.data,parentFormat);return;}
    if (node.nodeName === 'BUTTON' && node.getAttribute?.('data-note-checkbox') === 'true') return;
    if (node.nodeName === 'HR') {runs.push({text:'',block:'divider'});return;}
    if (node.nodeName === 'DETAILS') {
      const summary = [...node.childNodes].find(child => child.nodeName === 'SUMMARY');
      const title = summary?.querySelector?.('.notes-toggle-title') || summary;
      const bodyNodes = [...node.childNodes].filter(child => child !== summary);
      const {block:_block,listDepth:_listDepth,checked:_checked,...inlineFormat} = parentFormat;
      const summaryRuns = title ? noteRuns(readNoteEditor(title,inlineFormat)).map(({block:_block,listDepth:_listDepth,checked:_checked,...run}) => run) : [];
      const body = {nodeName:'DIV',childNodes:bodyNodes,firstChild:bodyNodes[0]};
      runs.push({text:'',block:'toggle',summary:summaryRuns,children:noteRuns(readNoteEditor(body,inlineFormat)),open:node.open !== false});
      return;
    }
    if (node.nodeName === 'A' && webLink(node.getAttribute('href'))) {
      const icon = node.querySelector('.notes-site-icon')?.getAttribute('src');
      append(node.querySelector('.notes-link-title, .notes-youtube-title')?.textContent ?? node.textContent,parentFormat,
        {url:node.getAttribute('href'),author:node.querySelector('.notes-link-site, .notes-youtube-author')?.textContent || '',
          ...(webLink(icon) ? {icon} : {})});return;
    }
    const format = nodeFormat(node,parentFormat);
    if (node.nodeName === 'BR') {append('\n',format);return;}
    if (!node.childNodes.length || (node.childNodes.length === 1 && node.firstChild.nodeName === 'BR')) {
      if (node.nodeName === 'LI') runs.push({text:'',...format});
      return;
    }
    const children = [...node.childNodes];
    if (node.nodeName === 'LI' && format.block === 'checklist' && !children.some(child=>
      !['UL','OL'].includes(child.nodeName) && child.getAttribute?.('data-note-checkbox') == null && child.textContent)) {
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
