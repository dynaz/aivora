import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('API enforces CSRF, exposes health, charges once and persists across process restart', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aivora-api-'));
  let child;
  async function start() {
    child = spawn(process.execPath, ['src/server.mjs'], { env: { ...process.env, PORT: '0', AIVORA_DB: join(dir, 'db.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'] });
    return await new Promise((resolve, reject) => {
      let output = ''; const timer = setTimeout(() => reject(new Error('Server startup timeout')), 5000);
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Server exited before startup')); });
      child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    });
  }
  async function stop() { if (child && child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await done; } }
  try {
    let base = await start();

    // Health/readiness need no auth.
    assert.equal((await fetch(base + '/healthz')).status, 200);
    assert.equal((await fetch(base + '/readyz')).status, 200);

    // CSRF double-submit: obtain a token + cookie. The token is stateless, so it survives restarts.
    const csrfRes = await fetch(base + '/api/csrf');
    const csrfCookie = csrfRes.headers.get('set-cookie').split(';')[0];
    const csrfToken = (await csrfRes.json()).token;
    let cookies = csrfCookie;
    const post = (url, data, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, Cookie: cookies, ...headers }, body: JSON.stringify(data) });
    const get = (url, headers = {}) => fetch(url, { headers: { Cookie: cookies, ...headers } });

    assert.equal((await fetch(base + '/')).status, 200);
    assert.equal((await get(base + '/api/balance')).status, 401);

    // A state-changing POST without the CSRF header is rejected even with a valid session later.
    assert.equal((await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookies }, body: '{}' })).status, 403);

    const credentials = { email: 'test@example.com', password: 'a-long-test-password' };
    assert.equal((await post(base + '/api/register', credentials)).status, 201);
    const login = await post(base + '/api/login', credentials);
    const sessionCookie = login.headers.get('set-cookie').split(';')[0];
    cookies = csrfCookie + '; ' + sessionCookie;

    assert.equal((await get(base + '/premium')).status, 200);
    const plans = await (await get(base + '/api/premium/plans')).json();
    assert.equal(plans.sandbox, true); assert.equal(plans.plans.length, 2);
    const premium = await (await get(base + '/api/premium/status')).json();
    assert.equal(premium.terminowLinked, false); assert.equal(premium.expires, null);

    const chat = (id, message, headers = {}) => post(base + '/api/chat', { id, message }, headers);
    assert.equal((await chat('bad', '')).status, 400);
    assert.equal((await chat('bad', 'hello', { Origin: 'https://other.example' })).status, 403);
    assert.equal((await chat('once', 'hello')).status, 200);
    assert.equal((await (await chat('once', 'hello')).json()).charged, false);
    assert.equal((await chat('once', 'different')).status, 400);

    await stop(); base = await start();
    assert.equal((await (await get(base + '/api/balance')).json()).balance, 99);
    assert.equal((await (await chat('once', 'hello')).json()).charged, false);
    const history = await (await get(base + '/api/history')).json();
    assert.equal(history.transactions.length, 1);
    assert.equal('payload' in history.transactions[0], false);
  } finally { await stop(); rmSync(dir, { recursive: true, force: true }); }
});
