import { youtubeVideo } from './youtubeLinks.mjs';
import { noteColor, NOTE_TEXT_COLORS, serializeNoteRuns } from './noteRichText.mjs';

function nodeFormat(node,inherited) {
  const format = {...inherited}, style = node.style;
  if (['B','STRONG'].includes(node.nodeName)) format.bold = true;
  if (style?.fontWeight) format.bold = style.fontWeight === 'bold' || Number(style.fontWeight) >= 600;
  if (node.nodeName === 'U') format.underline = true;
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
  const decoration = style?.textDecorationLine || style?.textDecoration;
  if (decoration) format.underline = decoration.includes('underline');
  if (node.nodeName === 'MARK') format.highlight = true;
  if (style?.backgroundColor) format.highlight = ['#fff0a8','rgb(255,240,168)'].includes(style.backgroundColor.replace(/\s/g,'').toLowerCase());
  return format;
}

export function noteFormatAt(node,editor) {
  const ancestors = [];
  for (let current = node; current && current !== editor; current = current.parentNode) ancestors.unshift(current);
  return ancestors.reduce((format,current) => nodeFormat(current,format),{});
}

// Browser-created paragraphs and inline marks are serialized without storing raw HTML.
export function readNoteEditor(root,inherited = {}) {
  const runs = [];
  const append = (text,format,link) => {if (text) runs.push({text,...format,...link});};
  function read(node,parentFormat) {
    if (node.nodeType === 3) {append(node.data,parentFormat);return;}
    if (node.nodeName === 'HR') {runs.push({text:'',block:'divider'});return;}
    if (node.nodeName === 'A' && youtubeVideo(node.getAttribute('href'))) {
      append(node.querySelector('.notes-youtube-title')?.textContent ?? node.textContent,parentFormat,
        {url:node.getAttribute('href'),author:node.querySelector('.notes-youtube-author')?.textContent || ''});return;
    }
    const format = nodeFormat(node,parentFormat);
    if (node.nodeName === 'BR') {append('\n',format);return;}
    if (node.childNodes.length === 1 && node.firstChild.nodeName === 'BR') return;
    const children = [...node.childNodes];
    const block = child => ['DIV','P','LI','H1','H2','H3','BLOCKQUOTE','UL','OL','HR'].includes(child.nodeName);
    children.forEach((child,index) => {
      if (index && block(child) && !block(children[index - 1])) append('\n',format);
      read(child,format);
      if (block(child) && index < children.length - 1) append('\n',nodeFormat(child,format));
    });
  }
  read(root,inherited);
  return serializeNoteRuns(runs);
}
