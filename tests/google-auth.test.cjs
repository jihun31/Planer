const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readDesktopConfig, startGoogleLogin } = require('../electron/google-auth.cjs');
const config = { clientId: '123-test.apps.googleusercontent.com', clientSecret: 'desktop-test' };
async function session(fetchImpl, timeoutMs = 3000) {
  let opened;
  const ready = new Promise(resolve => { opened = resolve; });
  const login = startGoogleLogin({ config, openExternal: url => opened(new URL(url)), fetchImpl, timeoutMs });
  // Attach immediately to make cancellation failures observable without unhandled rejections.
  login.result.catch(() => {});
  const url = await ready;
  const callback = new URL(url.searchParams.get('redirect_uri'));
  callback.searchParams.set('state', url.searchParams.get('state'));
  callback.searchParams.set('code', 'test-code');
  return { ...login, url, callback };
}
test('only a downloaded desktop client for the correct project is accepted', () => {
  assert.throws(() => readDesktopConfig({ web: {} }));
  assert.throws(() => readDesktopConfig({ installed: { project_id: 'wrong', client_id: config.clientId } }));
  assert.equal(readDesktopConfig({ installed: { project_id: 'planer-f8cb7', client_id: config.clientId } }).clientId, config.clientId);
});
test('external Google browser login uses PKCE and exchanges code once without exposing token in browser', async () => {
  let requests = 0;
  const s = await session(async (url, options) => {
    requests++;
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(options.body.get('redirect_uri'), s.url.searchParams.get('redirect_uri'));
    assert.equal(options.body.get('client_secret'), config.clientSecret);
    assert.equal(options.body.get('code'), 'test-code');
    const challenge = createHash('sha256').update(options.body.get('code_verifier')).digest('base64url');
    assert.equal(challenge, s.url.searchParams.get('code_challenge'));
    return { ok: true, json: async () => ({ access_token: 'private-google-token', refresh_token: 'never-return' }) };
  });
  assert.equal(s.url.origin, 'https://accounts.google.com');
  assert.equal(s.url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(s.callback.hostname, '127.0.0.1');
  const response = await fetch(s.callback);
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes('private-google-token'));
  assert.deepEqual(await s.result, { accessToken: 'private-google-token' });
  assert.equal(requests, 1);
});
test('wrong state, wrong Host, wrong method, and wrong path cannot complete login', async () => {
  let calls = 0;
  const s = await session(async () => { calls++; throw Error('unexpected'); });
  try {
    const wrongState = new URL(s.callback);
    wrongState.searchParams.set('state', 'wrong');
    assert.equal((await fetch(wrongState)).status, 400);
    const wrongPath = new URL(s.callback); wrongPath.pathname = '/wrong';
    assert.equal((await fetch(wrongPath)).status, 400);
    assert.equal((await fetch(s.callback, { method: 'POST' })).status, 400);
    const badHostStatus = await new Promise((resolve, reject) => {
      require('node:http').get(s.callback, { headers: { Host: 'attacker.invalid' } }, res => {
        res.resume(); resolve(res.statusCode);
      }).on('error', reject);
    });
    assert.equal(badHostStatus, 400);
    assert.equal(calls, 0);
  } finally { s.cancel(); }
  await assert.rejects(s.result, { code: 'desktop/cancelled' });
});
test('duplicate callbacks do not exchange or return credentials twice', async () => {
  let release, called;
  const gate = new Promise(resolve => { release = resolve; });
  const exchangeStarted = new Promise(resolve => { called = resolve; });
  let count = 0;
  const s = await session(async () => {
    count++; called(); await gate;
    return { ok: true, json: async () => ({ access_token: 'token' }) };
  });
  const first = fetch(s.callback);
  await exchangeStarted;
  assert.equal((await fetch(s.callback)).status, 409);
  release();
  assert.equal((await first).status, 200);
  await s.result;
  assert.equal(count, 1);
});
test('denied consent is handled, receiver closes, no token call occurs', async () => {
  const s = await session(() => assert.fail('No token exchange'));
  s.callback.searchParams.delete('code');
  s.callback.searchParams.set('error', 'access_denied');
  assert.equal((await fetch(s.callback)).status, 400);
  await assert.rejects(s.result, { code: 'desktop/cancelled' });
});
test('token failure never returns credentials', async () => {
  const s = await session(async () => ({ ok: false }));
  assert.equal((await fetch(s.callback)).status, 502);
  await assert.rejects(s.result, { code: 'desktop/token-exchange-failed' });
});
test('timeout and browser launch failure terminate the login session', async () => {
  const s = startGoogleLogin({ config, openExternal: async () => {}, timeoutMs: 20 });
  await assert.rejects(s.result, { code: 'desktop/timeout' });
  const failed = startGoogleLogin({ config, openExternal: async () => { throw Error('failure'); } });
  await assert.rejects(failed.result, { code: 'desktop/browser-failed' });
});
