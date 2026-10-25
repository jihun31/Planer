import { escapeHtml } from './youtubeLinks.mjs';

export function webLink(value) {
  try {
    if (typeof value !== 'string' || value.length > 4096) return null;
    const url = new URL(value);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost')
      || /^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return null;
    return {url:url.href,host,icon:new URL('/favicon.ico',url).href};
  } catch {return null;}
}

export function siteLinkHtml(title,url,pasteId,author = '',icon) {
  const link = webLink(url);
  if (!link) return escapeHtml(title);
  const image = webLink(icon || link.icon)?.url;
  const fallback = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/></svg>';
  const site = author && author.toLowerCase() !== title.toLowerCase() ? `<span class="notes-link-site">${escapeHtml(author)}</span>` : '';
  return `<a class="notes-site-mention" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" contenteditable="false"${pasteId ? ` data-paste-id="${escapeHtml(pasteId)}"` : ''}><span class="notes-link-icon">${fallback}${image ? `<img class="notes-site-icon" src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>${site}<span class="notes-link-title">${escapeHtml(title)}</span></a>`;
}

const previews = new Map();
export function loadSiteInfo(value) {
  const link = webLink(value);
  if (!link) return Promise.reject(new Error('Invalid website URL'));
  if (!previews.has(link.url)) {
    const pending = (async () => {
      if (!globalThis.window?.electronAPI?.getLinkPreview) return {title:link.url,author:'',icon:link.icon};
      const result = await window.electronAPI.getLinkPreview(link.url);
      if (!result?.ok || typeof result.title !== 'string' || !result.title.trim()) throw new Error('Link preview unavailable');
      return {title:result.title.trim().slice(0,500),author:typeof result.author === 'string' ? result.author.slice(0,200) : '',
        icon:webLink(result.icon)?.url || link.icon};
    })().catch(error => {previews.delete(link.url);throw error;});
    previews.set(link.url,pending);
  }
  return previews.get(link.url);
}
