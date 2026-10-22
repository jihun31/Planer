import { escapeHtml, linkHtml, noteParts, youtubeToken, youtubeVideo } from './youtubeLinks.mjs';

const PREFIX = '\u001eplaner-note:1:';
const flags = ['bold','underline','highlight','italic'];
export const NOTE_HIGHLIGHT = '#fff0a8';
export const NOTE_TEXT_COLORS = [
  {value:'#0f172a',label:'기본'}, {value:'#787774',label:'회색'}, {value:'#9f6b53',label:'갈색'},
  {value:'#d9730d',label:'주황'}, {value:'#b88a00',label:'노랑'}, {value:'#448361',label:'초록'},
  {value:'#337ea9',label:'파랑'}, {value:'#9065b0',label:'보라'}, {value:'#d44c47',label:'빨강'},
];
export const NOTE_BLOCKS = [
  {value:'text',label:'일반 텍스트',icon:'T',search:'text paragraph 일반 텍스트'},
  {value:'h1',label:'제목 1',icon:'H1',search:'h1 heading1 제목 1'},
  {value:'h2',label:'제목 2',icon:'H2',search:'h2 heading2 제목 2'},
  {value:'h3',label:'제목 3',icon:'H3',search:'h3 heading3 제목 3'},
  {value:'quote',label:'인용',icon:'❝',search:'quote blockquote 인용'},
  {value:'bullet',label:'글머리 기호 목록',icon:'•',search:'bullet list ul 글머리 기호 목록'},
  {value:'divider',label:'구분선',icon:'—',search:'divider hr separator 구분선'},
];
const blockTypes = NOTE_BLOCKS.map(block => block.value).filter(value => value !== 'text');

export function noteColor(value) {
  let color = String(value || '').replace(/\s/g,'').toLowerCase();
  const rgb = color.match(/^rgb\((\d+),(\d+),(\d+)\)$/);
  if (rgb) color = '#' + rgb.slice(1).map(channel => Number(channel).toString(16).padStart(2,'0')).join('');
  return NOTE_TEXT_COLORS.some(item => item.value === color) ? color : null;
}

function validRun(run) {
  return run && typeof run.text === 'string'
    && Object.keys(run).every(key => ['text','url','author','color','block',...flags].includes(key))
    && flags.every(flag => !(flag in run) || typeof run[flag] === 'boolean')
    && (!('url' in run) || (typeof run.url === 'string' && !!youtubeVideo(run.url)))
    && (!('author' in run) || (typeof run.author === 'string' && !!run.url))
    && (!('color' in run) || (typeof run.color === 'string' && noteColor(run.color) === run.color))
    && (!('block' in run) || blockTypes.includes(run.block));
}

export function noteRuns(text) {
  if (text.startsWith(PREFIX)) {
    try {
      const runs = JSON.parse(text.slice(PREFIX.length));
      if (Array.isArray(runs) && runs.every(validRun)) return runs;
    } catch { /* An invalid document is displayed as literal text, never HTML. */ }
  }
  return noteParts(text).map(({text,...link}) => ({text,...link}));
}

export function serializeNoteRuns(runs) {
  const normalized = [];
  for (const item of runs) {
    if (item.block === 'divider') {normalized.push({text:'',block:'divider'});continue;}
    if (!item.text) continue;
    const run = {text:item.text};
    for (const flag of flags) if (item[flag]) run[flag] = true;
    const color = noteColor(item.color);
    if (color && color !== NOTE_TEXT_COLORS[0].value) run.color = color;
    if (blockTypes.includes(item.block)) run.block = item.block;
    if (item.url && youtubeVideo(item.url)) {run.url = item.url;if (item.author) run.author = item.author;}
    const previous = normalized.at(-1);
    if (previous && !run.url && !previous.url && flags.every(flag => !!previous[flag] === !!run[flag])
      && previous.color === run.color && previous.block === run.block) previous.text += run.text;
    else normalized.push(run);
  }
  const plain = normalized.map(run => run.url ? youtubeToken(run.text,run.url,run.author) : run.text).join('');
  return normalized.some(run => flags.some(flag => run[flag]) || run.color || run.block) || plain.startsWith(PREFIX)
    ? PREFIX + JSON.stringify(normalized) : plain;
}

export const notePlainText = text => noteRuns(text).map(run => run.block === 'divider' ? '---' : run.text).join('');
export function noteHtml(text, blockMode = false) {
  const runs = noteRuns(text);
  const inlineHtml = run => {
    let html = run.url ? linkHtml(run.text,run.url,null,run.author) : escapeHtml(run.text);
    if (run.color) html = `<span style="color:${run.color}">${html}</span>`;
    if (run.highlight) html = `<span style="background-color:${NOTE_HIGHLIGHT}">${html}</span>`;
    if (run.underline) html = `<u>${html}</u>`;
    if (run.bold) html = `<strong>${html}</strong>`;
    if (run.italic) html = `<em>${html}</em>`;
    return html;
  };
  if (blockMode || runs.some(run => run.block)) {
    const lines = [{runs:[],block:null}];
    for (const run of runs) {
      if (run.block === 'divider') {lines.at(-1).block = 'divider';continue;}
      const parts = run.text.split('\n');
      parts.forEach((part,index) => {
        const line = lines.at(-1);
        if (part) {
          line.runs.push({...run,text:part});
          if (run.block) line.block = run.block;
        }
        if (index < parts.length - 1) {
          if (!line.block && run.block) line.block = run.block;
          lines.push({runs:[],block:null});
        }
      });
    }
    let html = '', list = false;
    for (const line of lines) {
      const content = (line.runs.map(inlineHtml).join('') + (line.runs.at(-1)?.url ? ' ' : '')) || '<br>';
      if (line.block === 'bullet') {
        if (!list) html += '<ul>';
        html += `<li>${content}</li>`;
        list = true;
      } else {
        if (list) html += '</ul>';
        list = false;
        if (line.block === 'divider') {html += '<hr>';continue;}
        const tag = line.block === 'quote' ? 'blockquote' : ['h1','h2','h3'].includes(line.block) ? line.block : 'div';
        html += `<${tag}>${content}</${tag}>`;
      }
    }
    return html + (list ? '</ul>' : '');
  }
  const html = runs.map(inlineHtml).join('');
  // Leave an editable caret position after an atomic mention at the end of a note.
  return html + (runs.at(-1)?.url ? ' ' : '');
}
