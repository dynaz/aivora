import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// HTTP surface for account linking: minting a code requires a session; redeeming is public (the code is
// the bearer) and returns the linked account + entitlements; a replay over HTTP is rejected.
test('link code mint is authed; redeem is public, returns entitlements, and cannot be replayed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aivora-link-'));
  let child, base;
  const env = { ...process.env, PORT: '0', AIVORA_DB: join(dir, 'db.sqlite'), AIVR_DEVNET_MINT: 'MINT', AIVR_DEVNET_RECIPIENT_TOKEN_ACCOUNT: 'DEST' };
  function start() {
    child = spawn(process.execPath, ['src/server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    return new Promise((resolve, reject) => {
      let out = ''; const timer = setTimeout(() => reject(new Error('startup timeout')), 5000);
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.stdout.on('data', c => { out += c; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
    });
  }
  async function stop() { if (child && child.exitCode === null) { const done = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await done; } }
  try {
    base = await start();
    const c = await fetch(base + '/api/csrf');
    const csrfCookie = c.headers.get('set-cookie').split(';')[0];
    const csrfToken = (await c.json()).token;
    const post = (p, data, cook) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, Cookie: cook }, body: JSON.stringify(data) });

    // Minting a code without a session is rejected.
    assert.equal((await post('/api/link/code', {}, csrfCookie)).status, 401);

    const user = { email: 'buyer@example.com', password: 'a-long-password-here' };
    await post('/api/register', user, csrfCookie);
    const session = (await post('/api/login', user, csrfCookie)).headers.get('set-cookie').split(';')[0];
    const cookies = csrfCookie + '; ' + session;

    const mint = await post('/api/link/code', {}, cookies);
    assert.equal(mint.status, 201);
    const { code } = await mint.json();
    assert.ok(code && code.length >= 20);

    // Redeeming is public: it works with only the CSRF cookie, no session.
    const redeem = await post('/api/link/redeem', { code, terminowRef: 'device-7' }, csrfCookie);
    assert.equal(redeem.status, 200);
    const body = await redeem.json();
    assert.equal(body.email, 'buyer@example.com');
    assert.ok(Array.isArray(body.entitlements));

    // Replay over HTTP fails.
    const replay = await post('/api/link/redeem', { code, terminowRef: 'device-7' }, csrfCookie);
    assert.equal(replay.status, 400);
    assert.match((await replay.json()).error, /already used/);

    // The owner sees the link.
    const links = await (await fetch(base + '/api/link/links', { headers: { Cookie: cookies } })).json();
    assert.deepEqual(links.links.map(l => l.terminow_ref), ['device-7']);
  } finally { await stop(); rmSync(dir, { recursive: true, force: true }); }
});
