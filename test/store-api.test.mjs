import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exercises the storefront HTTP wiring (catalog, order, entitlements) end-to-end. Redemption itself is
// covered by store.test.mjs with an injected verifier; here we only confirm the authenticated,
// CSRF-protected request path and that a Devnet quote is shaped correctly. Mint/recipient are opaque
// placeholders — no real Devnet call is made because we never submit a signature.
test('storefront serves catalog and creates a Devnet quote under auth + CSRF', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aivora-store-'));
  let child;
  const env = { ...process.env, PORT: '0', AIVORA_DB: join(dir, 'db.sqlite'), AIVR_DEVNET_MINT: 'MintPlaceholder1111111111111111111111111111', AIVR_DEVNET_RECIPIENT_TOKEN_ACCOUNT: 'RecipientPlaceholder111111111111111111111111' };
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
    const base = await start();
    const csrfRes = await fetch(base + '/api/csrf');
    const csrfCookie = csrfRes.headers.get('set-cookie').split(';')[0];
    const csrfToken = (await csrfRes.json()).token;
    let cookies = csrfCookie;
    const post = (p, data) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, Cookie: cookies }, body: JSON.stringify(data) });
    const get = (p) => fetch(base + p, { headers: { Cookie: cookies } });

    assert.equal((await fetch(base + '/store')).status, 200);
    const creds = { email: 'buyer@example.com', password: 'a-long-test-password' };
    assert.equal((await post('/api/register', creds)).status, 201);
    const login = await post('/api/login', creds);
    cookies = csrfCookie + '; ' + login.headers.get('set-cookie').split(';')[0];

    const catalog = await (await get('/api/catalog')).json();
    assert.equal(catalog.sandbox, true);
    assert.equal(catalog.products.length, 3);

    assert.deepEqual(await (await get('/api/entitlements')).json(), { entitlements: [] });

    const orderRes = await post('/api/store/order', { productId: 'terminow-premium-30d', payer: '1'.repeat(40) });
    assert.equal(orderRes.status, 201);
    const order = await orderRes.json();
    assert.equal(order.featureKey, 'terminow-premium');
    assert.equal(order.amount, '10000000');
    assert.equal(order.memo, 'aivora:' + order.id);
    assert.equal(order.network, 'devnet');

    assert.equal((await post('/api/store/order', { productId: 'terminow-premium-30d', payer: 'not-a-wallet' })).status, 400);
  } finally { await stop(); rmSync(dir, { recursive: true, force: true }); }
});
