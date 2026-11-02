import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/migrations.mjs';
import { Admins } from '../src/admin.mjs';

// RBAC end-to-end: admin endpoints are forbidden until a role is assigned out-of-band (as the CLI
// does, by writing the admins table) — never through signup or any API. A promoted admin can grant an
// entitlement (reason required, audited) and the buyer immediately holds it.
test('admin endpoints require a role assigned out-of-band; granting is audited', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aivora-admin-'));
  const dbPath = join(dir, 'db.sqlite');
  let child, base;
  function start() {
    child = spawn(process.execPath, ['src/server.mjs'], { env: { ...process.env, PORT: '0', AIVORA_DB: dbPath }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    const get = (p, cook) => fetch(base + p, { headers: { Cookie: cook } });

    const admin = { email: 'root@example.com', password: 'a-long-admin-password' };
    const buyer = { email: 'buyer@example.com', password: 'a-long-buyer-password' };
    await post('/api/register', admin, csrfCookie);
    const adminSession = (await post('/api/login', admin, csrfCookie)).headers.get('set-cookie').split(';')[0];
    await post('/api/register', buyer, csrfCookie);
    const buyerSession = (await post('/api/login', buyer, csrfCookie)).headers.get('set-cookie').split(';')[0];
    const adminCookies = csrfCookie + '; ' + adminSession;
    const buyerCookies = csrfCookie + '; ' + buyerSession;

    // Before promotion the admin account is just a user: no role, no access.
    assert.equal((await (await get('/api/admin/whoami', adminCookies)).json()).role, null);
    assert.equal((await get('/api/admin/catalog', adminCookies)).status, 403);

    // Promote out-of-band (what scripts/admin.mjs does), server stopped.
    await stop();
    const d = new DatabaseSync(dbPath); migrate(d); new Admins(d).setRole('root@example.com', 'superadmin'); d.close();
    base = await start();

    assert.equal((await (await get('/api/admin/whoami', adminCookies)).json()).role, 'superadmin');
    assert.equal((await get('/api/admin/catalog', adminCookies)).status, 200);
    assert.equal((await get('/api/admin/catalog', buyerCookies)).status, 403); // buyer still forbidden

    // Grant requires a reason.
    assert.equal((await post('/api/admin/grant', { email: 'buyer@example.com', featureKey: 'terminow-premium', days: 30 }, adminCookies)).status, 400);
    assert.equal((await post('/api/admin/grant', { email: 'buyer@example.com', featureKey: 'terminow-premium', days: 30, reason: 'comp' }, adminCookies)).status, 200);

    const ent = await (await get('/api/entitlements', buyerCookies)).json();
    assert.equal(ent.entitlements.length, 1);
    assert.equal(ent.entitlements[0].feature_key, 'terminow-premium');

    const events = await (await get('/api/admin/events', adminCookies)).json();
    assert.ok(events.events.find(e => e.kind === 'grant'));
    const audit = await (await get('/api/admin/audit', adminCookies)).json();
    assert.ok(audit.audit.find(a => a.action === 'grant' && a.reason === 'comp'));
  } finally { await stop(); rmSync(dir, { recursive: true, force: true }); }
});
