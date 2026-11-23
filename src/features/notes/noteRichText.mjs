import { escapeHtml, linkHtml, noteParts, youtubeToken, youtubeVideo } from './youtubeLinks.mjs';
import { webLink, siteLinkHtml } from './siteLinks.mjs';
import { decodeNoteImages, encodeNoteImages, noteImageMarkup, noteImageWidth, validNoteImageId } from './noteImages.mjs';

const PREFIX = '\u001eplaner-note:1:';
const flags = ['bold','underline','highlight','italic','strike'];
export const NOTE_HIGHLIGHT = '#fff0a8';
export const MAX_NOTE_LIST_DEPTH = 8;
export const MAX_NOTE_LIST_START = 9999;
const validListStart = (run,value) => (run.block === 'numbered' || (run.block === 'list-text' && run.listNumbered === true))
  && Number.isInteger(value) && value > 1 && value <= MAX_NOTE_LIST_START;
export const NOTE_TEXT_COLORS = [
  {value:'#0f172a',label:'기본'}, {value:'#787774',label:'회색'}, {value:'#9f6b53',label:'갈색'},
  {value:'#d9730d',label:'주황'}, {value:'#b88a00',label:'노랑'}, {value:'#448361',label:'초록'},
  {value:'#337ea9',label:'파랑'}, {value:'#9065b0',label:'보라'}, {value:'#d44c47',label:'빨강'},
];
export const NOTE_BLOCKS = [
  {value:'text',label:'일반 텍스트',icon:'T',search:'text paragraph 일반 텍스트'},
  {value:'h3',label:'제목',icon:'H',search:'h3 heading title 제목'},
  {value:'quote',label:'인용',icon:'❝',search:'quote blockquote 인용'},
  {value:'bullet',label:'글머리 기호 목록',icon:'•',search:'bullet list ul 글머리 기호 목록'},
  {value:'numbered',label:'숫자 목록',icon:'1.',search:'number numbered ordered list ol 숫자 번호 목록 리스트'},
  {value:'checklist',label:'체크리스트',icon:'☑',search:'checklist checkbox todo to-do 할 일 체크리스트 체크박스'},
  {value:'divider',label:'구분선',icon:'—',search:'divider hr separator 구분선'},
  {value:'toggle',label:'토글',icon:'▸',search:'toggle 토글',toolbarOnly:true},
];
// Existing documents can still contain the heading types removed from the menu.
const listBlocks = ['bullet','numbered','checklist','list-text'];
const blockTypes = ['h1','h2','list-text',...NOTE_BLOCKS.map(block => block.value).filter(value => value !== 'text')];

export function noteColor(value) {
  let color = String(value || '').replace(/\s/g,'').toLowerCase();
  const rgb = color.match(/^rgb\((\d+),(\d+),(\d+)\)$/);
  if (rgb) color = '#' + rgb.slice(1).map(channel => Number(channel).toString(16).padStart(2,'0')).join('');
  return NOTE_TEXT_COLORS.some(item => item.value === color) ? color : null;
}

function validRun(run,depth = 0) {
  if (run?.block === 'toggle') return depth < 16 && run.text === ''
    && Object.keys(run).every(key => ['text','block','summary','children','open'].includes(key))
    && typeof run.open === 'boolean' && Array.isArray(run.summary) && Array.isArray(run.children)
    && [...run.summary,...run.children].every(child => validRun(child,depth + 1));
  return run && typeof run.text === 'string'
    && Object.keys(run).every(key => ['text','url','inlineLink','author','icon','color','block','listDepth','checked','listNumbered','listContinuation','listStart',...flags].includes(key))
    && flags.every(flag => !(flag in run) || typeof run[flag] === 'boolean')
    && (!('url' in run) || (typeof run.url === 'string' && !!webLink(run.url)))
    && (!('inlineLink' in run) || (run.inlineLink === true && !!run.url))
    && (!('author' in run) || (typeof run.author === 'string' && !!run.url))
    && (!('icon' in run) || (typeof run.icon === 'string' && !!run.url && !!webLink(run.icon)))
    && (!('color' in run) || (typeof run.color === 'string' && noteColor(run.color) === run.color))
    && (!('block' in run) || blockTypes.includes(run.block))
    && (!('checked' in run) || (run.block === 'checklist' && typeof run.checked === 'boolean'))
    && (!('listNumbered' in run) || (run.block === 'list-text' && run.listNumbered === true))
    && (!('listContinuation' in run) || (run.block === 'list-text' && run.listContinuation === true))
    && (!('listStart' in run) || validListStart(run,run.listStart))
    && (!('listDepth' in run) || (listBlocks.includes(run.block) && Number.isInteger(run.listDepth)
      && run.listDepth >= 0 && run.listDepth <= MAX_NOTE_LIST_DEPTH));
}

export function noteRuns(text) {
  if (text.startsWith(PREFIX)) {
    try {
      const runs = JSON.parse(text.slice(PREFIX.length));
      if (Array.isArray(runs) && runs.every(run => validRun(run))) return decodeNoteImages(runs);
    } catch { /* An invalid document is displayed as literal text, never HTML. */ }
  }
  return decodeNoteImages(noteParts(text).map(({text,...link}) => ({text,...link})));
}

function normalizeRuns(runs,depth = 0) {
  if (depth >= 16) return [];
  const normalized = [];
  for (const item of runs) {
    if (item.block === 'toggle') {
      normalized.push({text:'',block:'toggle',summary:normalizeRuns(item.summary || [],depth + 1),
        children:normalizeRuns(item.children || [],depth + 1),open:item.open !== false});
      continue;
    }
    if (item.block === 'divider') {normalized.push({text:'',block:'divider'});continue;}
    if (!item.text && !listBlocks.includes(item.block) && !validNoteImageId(item.imageId)) continue;
    const run = {text:item.text};
    if (validNoteImageId(item.imageId)) {
      run.imageId = item.imageId;
      const width = noteImageWidth(item.imageWidth);
      if (width) run.imageWidth = width;
    }
    for (const flag of flags) if (item[flag]) run[flag] = true;
    const color = noteColor(item.color);
    if (color && color !== NOTE_TEXT_COLORS[0].value) run.color = color;
    if (blockTypes.includes(item.block)) run.block = item.block;
    if (run.block === 'checklist') run.checked = item.checked === true;
    if (run.block === 'list-text' && item.listNumbered) run.listNumbered = true;
    if (run.block === 'list-text' && item.listContinuation) run.listContinuation = true;
    if (validListStart(run,item.listStart)) run.listStart = item.listStart;
    if (listBlocks.includes(run.block) && Number.isInteger(item.listDepth) && item.listDepth > 0) run.listDepth = Math.min(item.listDepth,MAX_NOTE_LIST_DEPTH);
    if (item.url && !run.imageId && webLink(item.url)) {
      run.url = item.url;
      if (item.inlineLink) run.inlineLink = true;
      else {
        if (item.author) run.author = item.author;
        if (item.icon && webLink(item.icon)) run.icon = item.icon;
      }
    }
    const previous = normalized.at(-1);
    if (previous && run.text && !run.url && !previous.url && !previous.imageId && flags.every(flag => !!previous[flag] === !!run[flag])
      && previous.color === run.color && previous.block === run.block && previous.listDepth === run.listDepth && previous.checked === run.checked
      && previous.listNumbered === run.listNumbered && previous.listContinuation === run.listContinuation && previous.listStart === run.listStart) previous.text += run.text;
    else normalized.push(run);
  }
  return normalized;
}

export function serializeNoteRuns(runs) {
  const normalized = normalizeRuns(runs);
  const plain = normalized.map(run => run.url ? youtubeToken(run.text,run.url,run.author) : run.text).join('');
  return normalized.some(run => flags.some(flag => run[flag]) || run.color || run.block || run.icon || run.imageId || run.inlineLink || (run.url && !youtubeVideo(run.url))) || plain.startsWith(PREFIX)
    ? PREFIX + JSON.stringify(encodeNoteImages(normalized)) : plain;
}

const plainRuns = runs => runs.map(run => run.block === 'toggle' ? `${plainRuns(run.summary)}\n${plainRuns(run.children)}`
  : run.block === 'divider' ? '---' : run.imageId ? '[사진]' : run.text).join('');
export const notePlainText = text => plainRuns(noteRuns(text));

export function createNoteToggle(runs) {
  const summary = [], children = [];
  let inBody = false;
  for (const run of runs) {
    if (inBody) {children.push(run);continue;}
    const index = run.text.indexOf('\n');
    const {block:_block,listDepth:_listDepth,checked:_checked,listNumbered:_numbered,listContinuation:_continuation,listStart:_start,...inline} = run;
    summary.push({...inline,text:index < 0 ? run.text : run.text.slice(0,index)});
    if (index >= 0) {
      inBody = true;
      if (index + 1 < run.text.length) children.push({...run,text:run.text.slice(index + 1)});
    }
  }
  return {text:'',block:'toggle',summary:normalizeRuns(summary),children:normalizeRuns(children),open:true};
}

export function noteHtml(text, blockMode = false, textColor = null) {
  return renderRuns(noteRuns(text),blockMode,textColor);
}


function renderRuns(runs,blockMode,textColor) {
  const linkNeedsCaret = run => run?.url && !run.inlineLink;
  const inlineHtml = run => {
    if (run.imageId) return noteImageMarkup(run.imageId,run.imageWidth);
    let html = run.url && !run.inlineLink ? (youtubeVideo(run.url) ? linkHtml(run.text,run.url,null,run.author)
      : siteLinkHtml(run.text,run.url,null,run.author,run.icon)) : escapeHtml(run.text);
    const color = noteColor(textColor) || run.color;
    if (color) html = `<span style="color:${color}">${html}</span>`;
    if (run.highlight) html = `<span style="background-color:${NOTE_HIGHLIGHT}">${html}</span>`;
    if (run.underline) html = `<u>${html}</u>`;
    if (run.strike) html = `<s>${html}</s>`;
    if (run.bold) html = `<strong>${html}</strong>`;
    if (run.italic) html = `<em>${html}</em>`;
    return run.inlineLink
      ? `<a href="${escapeHtml(run.url)}" target="_blank" rel="noopener noreferrer">${html}</a>`
      : html;
  };
  if (blockMode || runs.some(run => run.block)) {
    const lines = [{runs:[],block:null}];
    for (const run of runs) {
      if (run.block === 'divider' || run.block === 'toggle') {
        // Structural blocks own a line even when stored runs have no separating newline.
        if (lines.at(-1).runs.length || lines.at(-1).block) lines.push({runs:[],block:null});
        lines.at(-1).block = run.block;lines.at(-1).toggle = run;continue;
      }
      const setListFormat = line => {
        line.listDepth = run.listDepth || 0;
        line.checked = run.checked === true;
        line.listNumbered = run.listNumbered === true;
        line.listContinuation = run.listContinuation === true;
        line.listStart = run.listStart || 0;
      };
      const parts = run.text.split('\n');
      parts.forEach((part,index) => {
        let line = lines.at(-1);
        if (part || run.imageId || (!run.text && listBlocks.includes(run.block))) {
          if (line.block === 'divider' || line.block === 'toggle') {
            line = {runs:[],block:null};lines.push(line);
          }
          if (part || run.imageId) line.runs.push({...run,text:part});
          if (run.block) line.block = run.block;
          if (listBlocks.includes(run.block)) setListFormat(line);
        }
        if (index < parts.length - 1) {
          if (!line.block && run.block) {line.block = run.block;setListFormat(line);}
          lines.push({runs:[],block:null});
        }
      });
    }
    let html = '', listBase = 0;
    const listTags=[];
    const closeList=()=>{html+=`</li></${listTags.pop()}>`;};
    const closeLists = () => {while (listTags.length) closeList();};
    for (const line of lines) {
      const content = (line.runs.map(inlineHtml).join('') + (linkNeedsCaret(line.runs.at(-1)) ? ' ' : '')) || '<br>';
      if (listBlocks.includes(line.block)) {
        if (!listTags.length) listBase = line.listDepth || 0;
        const level = Math.min(Math.max(1,(line.listDepth || 0)-listBase+1),listTags.length+1);
        const tag=line.block==='numbered'||line.listNumbered?'ol':'ul';
        const open = `<${tag}${tag === 'ol' && line.listStart > 1 ? ` start="${line.listStart}"` : ''}>`;
        if (level > listTags.length) {html += open;listTags.push(tag);}
        else {
          while (listTags.length > level) closeList();
          if(listTags.at(-1)!==tag){closeList();html+=open;listTags.push(tag);}
          else html += '</li>';
        }
        if (line.block === 'list-text') {
          html += `<li data-note-list-text="${line.listContinuation ? 'continuation' : 'text'}"><span data-note-list-content${line.listContinuation ? ' hidden' : ''}>${content}</span>`;
          continue;
        }
        html += line.block === 'checklist'
          ? `<li class="notes-checklist-item" data-note-checked="${line.checked}"><button type="button" class="notes-checkbox" data-note-checkbox="true" role="checkbox" aria-label="체크리스트 완료" aria-checked="${line.checked}" contenteditable="false"></button><span class="notes-checklist-text">${content}</span>`
          : `<li>${content}`;
      } else {
        closeLists();
        if (line.block === 'divider') {html += '<hr>';continue;}
        if (line.block === 'toggle') {
          const toggle = line.toggle;
          const summary = renderRuns(toggle.summary,false,textColor).replace(/\n/g,'<br>') || '<br>';
          html += `<details class="notes-toggle"${toggle.open ? ' open' : ''}><summary><span class="notes-toggle-arrow" contenteditable="false" aria-hidden="true">▸</span><span class="notes-toggle-title">${summary}</span></summary><div class="notes-toggle-body">${renderRuns(toggle.children,true,textColor)}</div></details>`;
          continue;
        }
        const tag = line.block === 'quote' ? 'blockquote' : ['h1','h2','h3'].includes(line.block) ? line.block : 'div';
        html += `<${tag}>${content}</${tag}>`;
      }
    }
    closeLists();return html;
  }
  const html = runs.map(inlineHtml).join('');
  // Leave an editable caret position after an atomic mention at the end of a note.
  return html + (linkNeedsCaret(runs.at(-1)) ? ' ' : '');
}
