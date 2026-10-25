const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const { isIP } = require('node:net');

function publicAddress(address) {
  if (isIP(address) === 6) return /^[23]/i.test(address) && !/^2001:db8:/i.test(address);
  if (isIP(address) !== 4) return false;
  const [a,b] = address.split('.').map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a < 224
    && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && [0,168].includes(b)) && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 198 && [18,19].includes(b));
}

function websiteUrl(value,base) {
  const url = new URL(value,base);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.href.length > 4096
    || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || (isIP(host) ? !publicAddress(host) : !host.includes('.'))) throw new Error('Invalid website URL');
  return url;
}

function publicLookup(hostname,options,callback) {
  dns.lookup(hostname,{all:true},(error,addresses) => {
    if (error) {callback(error);return;}
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) {callback(new Error('Private address'));return;}
    if (options.all) callback(null,addresses);
    else callback(null,addresses[0].address,addresses[0].family);
  });
}

function requestPage(url) {
  return new Promise((resolve,reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const timer = setTimeout(() => request.destroy(new Error('Link preview timeout')),8000);
    const request = client.get(url,{lookup:publicLookup,headers:{
      'User-Agent':'Mozilla/5.0 (compatible; Planer/1.0; LinkPreview)',Accept:'text/html,application/xhtml+xml',
    }},response => {
      if ([301,302,303,307,308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.destroy();resolve({location});return;
      }
      if (response.statusCode !== 200 || !/text\/html|application\/xhtml\+xml/i.test(response.headers['content-type'] || '')) {
        response.destroy();reject(new Error('Page unavailable'));return;
      }
      const chunks = [];let bytes = 0, finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        const type = response.headers['content-type'] || '';
        const charset = type.match(/charset=["']?([\w-]+)/i)?.[1] || 'utf-8';
        let html;
        try {html = new TextDecoder(charset).decode(Buffer.concat(chunks));}
        catch {html = Buffer.concat(chunks).toString('utf8');}
        resolve({html});
      };
      response.on('data',chunk => {
        chunks.push(chunk.subarray(0,Math.max(0,512 * 1024 - bytes)));bytes += chunk.length;
        if (bytes >= 512 * 1024 || Buffer.concat(chunks.slice(-2)).toString().toLowerCase().includes('</head>')) {
          finish();response.destroy();
        }
      });
      response.on('end',finish);response.on('error',reject);
    });
    request.on('error',reject);request.on('close',()=>clearTimeout(timer));
  });
}

function decodeText(value) {
  const entities = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ndash:'–',mdash:'—',hellip:'…',rsquo:'’',lsquo:'‘',ldquo:'“',rdquo:'”'};
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(match,key) => {
    if (key[0] !== '#') return entities[key.toLowerCase()] ?? match;
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  }).replace(/\s+/g,' ').trim();
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decodeText(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

function extractMetadata(html,value) {
  const url = websiteUrl(value);
  const head = html.split(/<\/head\s*>/i)[0].replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');
  const meta = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = attributes(tag);
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (attrs.content && !meta[key]) meta[key] = attrs.content;
  }
  const title = (meta['og:title'] || meta['twitter:title'] || decodeText(head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || '') || url.href).slice(0,500);
  const author = (meta['og:site_name'] || url.hostname.replace(/^www\./,'')).slice(0,200);
  const icons = (head.match(/<link\b[^>]*>/gi) || []).map(attributes)
    .filter(attrs => attrs.href && /^(?:icon|shortcut icon|apple-touch-icon)$/i.test(attrs.rel || ''));
  let icon = new URL('/favicon.ico',url).href;
  for (const item of icons.sort((a,b) => Number(/apple/i.test(a.rel)) - Number(/apple/i.test(b.rel)))) {
    try {icon = websiteUrl(item.href,url).href;break;} catch { /* Try the next icon. */ }
  }
  return {title,author:author.toLowerCase() === title.toLowerCase() ? '' : author,icon};
}

async function loadLinkPreview(value,request = requestPage) {
  let url = websiteUrl(value);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const page = await request(url);
    if (page.location) {url = websiteUrl(page.location,url);continue;}
    return extractMetadata(page.html,url.href);
  }
  throw new Error('Too many redirects');
}

module.exports = {loadLinkPreview,extractMetadata};
