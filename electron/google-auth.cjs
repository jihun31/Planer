const http = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');

function authError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function readDesktopConfig(json) {
  const c = json?.installed;
  if (!c || c.project_id !== 'planer-f8cb7' ||
      typeof c.client_id !== 'string' || !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(c.client_id)) {
    throw authError('desktop/config-missing');
  }
  return { clientId: c.client_id, clientSecret: typeof c.client_secret === 'string' ? c.client_secret : '' };
}

// A short-lived loopback receiver. No tokens are written to disk or sent in URLs.
function startGoogleLogin({ config, openExternal, fetchImpl = fetch, timeoutMs = 180000 }) {
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const abort = new AbortController();
  let settled = false, processing = false, redirectUri, timer;
  let resolveResult, rejectResult;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  function finish(error, value) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    abort.abort();
    server.close();
    server.closeAllConnections();
    if (error) rejectResult(error); else resolveResult(value);
  }
  function respond(res, status, message) {
    res.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      Connection: 'close',
    });
    res.end(message);
  }
  const server = http.createServer(async (req, res) => {
    if (!redirectUri) { respond(res, 503, 'Not ready'); return; }
    const expected = new URL(redirectUri);
    if (req.method !== 'GET' || req.headers.host !== expected.host) {
      respond(res, 400, 'Invalid request'); return;
    }
    let url;
    try { url = new URL(req.url, redirectUri); } catch { respond(res, 400, 'Invalid request'); return; }
    const receivedState = url.searchParams.get('state') || '';
    if (url.origin !== expected.origin || url.pathname !== '/oauth/callback' ||
        url.searchParams.getAll('state').length !== 1 ||
        Buffer.byteLength(receivedState) !== Buffer.byteLength(state) ||
        !timingSafeEqual(Buffer.from(receivedState), Buffer.from(state))) {
      respond(res, 400, 'Invalid login request'); return;
    }
    if (processing || settled) { respond(res, 409, 'Login already handled'); return; }
    const providerError = url.searchParams.get('error');
    if (providerError) {
      respond(res, 400, '로그인이 취소되었습니다. Planer로 돌아가 다시 시도해 주세요.');
      finish(authError(providerError === 'access_denied' ? 'desktop/cancelled' : 'desktop/provider-error'));
      return;
    }
    const code = url.searchParams.get('code');
    if (!code || code.length > 4096 || url.searchParams.getAll('code').length !== 1) {
      respond(res, 400, 'Missing authorization code'); return;
    }
    processing = true;
    const body = new URLSearchParams({
      client_id: config.clientId, code, code_verifier: verifier,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    });
    if (config.clientSecret) body.set('client_secret', config.clientSecret);
    try {
      const response = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST', body, signal: abort.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (!response.ok) throw authError('desktop/token-exchange-failed');
      const tokens = await response.json();
      if (typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.access_token.length > 16384) {
        throw authError('desktop/token-exchange-failed');
      }
      if (settled) return;
      respond(res, 200, 'Google 인증을 마쳤습니다. Planer에서 로그인 결과를 확인해 주세요. 이 창은 닫아도 됩니다.');
      finish(null, { accessToken: tokens.access_token });
    } catch {
      if (!settled) {
        respond(res, 502, '로그인에 실패했습니다. Planer에서 다시 시도해 주세요.');
        finish(authError('desktop/token-exchange-failed'));
      }
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.on('error', () => finish(authError('desktop/connection-failed')));
  timer = setTimeout(() => finish(authError('desktop/timeout')), timeoutMs);
  server.listen(0, '127.0.0.1', async () => {
    if (settled) { server.close(); return; }
    const port = server.address().port;
    redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: 'openid email profile', prompt: 'select_account', state,
      code_challenge: challenge, code_challenge_method: 'S256',
    }).toString();
    try { await openExternal(url.toString()); }
    catch { finish(authError('desktop/browser-failed')); }
  });
  return { result, cancel: () => finish(authError('desktop/cancelled')) };
}

module.exports = { readDesktopConfig, startGoogleLogin };
