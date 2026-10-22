const VIDEO_ID = /^[\w-]{11}$/;

export function youtubeVideo(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    const id = host === 'youtu.be' ? parts[0]
      : ['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host)
        ? url.pathname === '/watch' ? url.searchParams.get('v')
          : ['shorts','live','embed'].includes(parts[0]) ? parts[1] : null
        : null;
    if (!id || !VIDEO_ID.test(id)) return null;
    const time = url.searchParams.get('t') || url.searchParams.get('start');
    return {id,url:`https://www.youtube.com/watch?v=${id}${time && /^\d+(?:h\d*m?\d*s?|m\d*s?|s)?$/.test(time) ? `&t=${time}` : ''}`};
  } catch { return null; }
}

export const escapeHtml = text => text.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function youtubeToken(title,url,author = '') {
  const channel = author ? ` "${author.replace(/\s+/g,' ').replace(/[\\"]/g,'\\$&')}"` : '';
  return `[${title.replace(/\s+/g,' ').replace(/[\\[\]]/g,'\\$&')}](${url}${channel})`;
}

// Only our YouTube link notation is interpreted. All other note content stays plain text.
export function noteParts(text) {
  const pattern = /\[((?:\\.|[^\]\\\n])+)\]\((https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}(?:&t=[\w]+)?)(?: "((?:\\.|[^"\\\n])*)")?\)/g;
  const parts = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    if (!youtubeVideo(match[2])) continue;
    if (match.index > end) parts.push({text:text.slice(end,match.index)});
    parts.push({text:match[1].replace(/\\([\\[\]])/g,'$1'),url:match[2],...(match[3] ? {author:match[3].replace(/\\([\\"])/g,'$1')} : {})});
    end = match.index + match[0].length;
  }
  if (end < text.length) parts.push({text:text.slice(end)});
  return parts;
}

export const notePlainText = text => noteParts(text).map(part => part.text).join('');
export function linkHtml(title,url,pasteId,author = '') {
  const icon = '<svg class="notes-youtube-icon" viewBox="0 0 24 17" aria-hidden="true" focusable="false"><rect width="24" height="17" rx="5" fill="#f2293d"/><path d="M9.5 4.5 16 8.5 9.5 12.5Z" fill="white"/></svg>';
  return `<a class="notes-youtube-mention" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" contenteditable="false"${pasteId ? ` data-paste-id="${pasteId}"` : ''}>${icon}${author ? `<span class="notes-youtube-author">${escapeHtml(author)}</span>` : ''}<span class="notes-youtube-title">${escapeHtml(title)}</span></a>`;
}
export const noteHtml = text => noteParts(text).map(part => part.url ? linkHtml(part.text,part.url,null,part.author) : escapeHtml(part.text)).join('');

const titles = new Map();
export function loadYouTubeInfo(value) {
  const video = youtubeVideo(value);
  if (!video) return Promise.reject(new Error('Invalid YouTube video'));
  if (!titles.has(video.id)) {
    titles.set(video.id,(async () => {
      let title, author;
      if (globalThis.window?.electronAPI?.getYouTubeTitle) {
        const result = await window.electronAPI.getYouTubeTitle(video.id);
        if (!result.ok) throw new Error('YouTube title unavailable');
        title = result.title;
        author = result.author;
      } else {
        const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${video.id}`)}`,
          {credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.timeout(10000)});
        if (!response.ok) throw new Error('YouTube title unavailable');
        const data = await response.json();
        title = data.title; author = data.author_name;
      }
      if (typeof title !== 'string' || !title.trim() || title.length > 500) throw new Error('Invalid video title');
      return {title:title.trim().replace(/\s+/g,' '),author:typeof author === 'string' ? author.trim().replace(/\s+/g,' ').slice(0,200) : ''};
    })().catch(error => {titles.delete(video.id);throw error;}));
  }
  return titles.get(video.id);
}
