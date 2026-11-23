import { MAX_NOTE_LIST_DEPTH, MAX_NOTE_LIST_START, notePlainText, noteRuns, serializeNoteRuns } from './noteRichText.mjs';
import { webLink } from './siteLinks.mjs';

const listBlocks = ['bullet','numbered','checklist','list-text'];
const columns = indent => [...indent].reduce((width,char) => width + (char === '\t' ? 4 : 1),0);

function listLine(line) {
  const [,indent,rest] = line.match(/^([ \t]*)(.*)$/);
  let match = rest.match(/^(?:[-*+]\s+)?\[([ xX]?)\]\s+(.*)$/);
  if (match) return {indent,block:'checklist',checked:match[1].toLowerCase() === 'x',text:match[2]};
  match = rest.match(/^[-*+•·◦▪]\s+(.*)$/);
  if (match) return {indent,block:'bullet',text:match[1]};
  match = rest.match(/^(\d{1,4})[.)]\s+(.*)$/);
  if (match) return {indent,block:'numbered',number:Number(match[1]),text:match[2]};
  return null;
}

function textRuns(text,format) {
  return text.split(/(https?:\/\/[^\s<>"']+)/g).filter(Boolean).map(part => {
    const link = /^https?:\/\//.test(part) && webLink(part);
    return link ? {text:part,url:link.url,inlineLink:true,...format} : {text:part,...format};
  });
}

// Plain text whose lines start with "- ", "* ", "1. " or "[ ] " becomes list rows,
// with leading spaces or tabs as depth. Returns null when there is no such list.
export function noteListFromPlainText(plain) {
  const lines = plain.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n');
  if (lines.length < 2) return null;
  const parsed = lines.map(listLine);
  if (!parsed.some(Boolean)) return null;
  const indents = parsed.filter(Boolean).map(line => columns(line.indent)).filter(width => width > 0);
  const unit = Math.max(2,Math.min(...indents,4));
  const runs = [], sequence = [];
  let previousDepth = -1;
  lines.forEach((line,index) => {
    const item = parsed[index];
    let format = {};
    if (item) {
      const depth = Math.min(Math.round(columns(item.indent) / unit),previousDepth + 1,MAX_NOTE_LIST_DEPTH);
      sequence.length = depth + 1;
      format = {block:item.block,...(depth ? {listDepth:depth} : {})};
      if (item.block === 'checklist') format.checked = item.checked;
      if (item.block === 'numbered' && sequence[depth] !== 'numbered' && item.number > 1 && item.number <= MAX_NOTE_LIST_START) format.listStart = item.number;
      sequence[depth] = item.block;previousDepth = depth;
      const content = textRuns(item.text,format);
      runs.push(...(content.length ? content : [{text:'',...format}]));
    } else {
      sequence.length = 0;previousDepth = -1;
      runs.push(...textRuns(line,format));
    }
    if (index < lines.length - 1) runs.push({text:'\n',...format});
  });
  return serializeNoteRuns(runs);
}

// Plain text for other apps keeps list markers, numbers and depth.
export function noteClipboardText(text) {
  const runs = noteRuns(text);
  if (!runs.some(run => listBlocks.includes(run.block))) return notePlainText(text);
  const lines = [{text:'',format:null}];
  for (const run of runs) {
    if (run.block === 'toggle' || run.block === 'divider' || run.imageId) {
      lines.at(-1).text += notePlainText(serializeNoteRuns([run]));continue;
    }
    run.text.split('\n').forEach((part,index,parts) => {
      const line = lines.at(-1);
      line.text += part;
      // A newline belongs to the line it ends, not to the next line.
      if (run.block && !line.format && (part || !run.text || index < parts.length - 1)) line.format = run;
      if (index < parts.length - 1) lines.push({text:'',format:null});
    });
  }
  const counters = [];
  let base = null;
  return lines.flatMap(({text,format}) => {
    if (!listBlocks.includes(format?.block)) {counters.length = 0;base = null;return [text];}
    if (format.listContinuation) return [];
    if (base === null) base = format.listDepth || 0;
    const depth = Math.max(0,(format.listDepth || 0) - base), indent = '  '.repeat(depth);
    counters.length = depth + 1;
    if (format.block === 'list-text') return [indent + '  ' + text];
    if (format.block === 'numbered') {
      const number = counters[depth]?.numbered ? counters[depth].number + 1 : format.listStart || 1;
      counters[depth] = {numbered:true,number};
      return [`${indent}${number}. ${text}`];
    }
    counters[depth] = {numbered:false};
    return [indent + (format.block === 'checklist' ? (format.checked ? '- [x] ' : '- [ ] ') : '- ') + text];
  }).join('\n');
}
