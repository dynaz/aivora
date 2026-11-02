import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/migrations.mjs';
import { Entitlements } from '../src/entitlements.mjs';

function db() { const d = new DatabaseSync(':memory:'); migrate(d); return d; }

test('admin grant extends from later of now/expiry; permanent add-on is never downgraded', () => {
  const d = db(); const e = new Entitlements(d); try {
    const exp1 = e.adminGrant('admin@x', 'u@x', 'terminow-premium', 30, 'launch', 1000);
    assert.equal(exp1, 1000 + 30 * 86400000);
    const exp2 = e.adminGrant('admin@x', 'u@x', 'terminow-premium', 30, 'extend', 2000); // now < exp1
    assert.equal(exp2, exp1 + 30 * 86400000);
    e.adminGrant('admin@x', 'u@x', 'addon-network-scan', null, 'gift', 1000);
    assert.equal(e.active('u@x', 'addon-network-scan'), true);
    assert.equal(e.list('u@x').length, 2);
    e.adminGrant('admin@x', 'u@x', 'addon-network-scan', 30, 'noop', 5000); // must not add an expiry
    assert.equal(e.list('u@x').find(r => r.feature_key === 'addon-network-scan').expires, null);
  } finally { d.close(); }
});

test('grant/revoke require a reason and write the audit log', () => {
  const d = db(); const e = new Entitlements(d); try {
    assert.throws(() => e.adminGrant('a', 'u', 'f', 30, ''), /reason/);
    assert.throws(() => e.adminRevoke('a', 'u', 'f', '  '), /reason/);
    e.adminGrant('a@x', 'u@x', 'terminow-premium', 30, 'paid support', 1000);
    e.adminRevoke('a@x', 'u@x', 'terminow-premium', 'chargeback', 2000);
    assert.equal(e.active('u@x', 'terminow-premium'), false);
    const log = e.auditLog();
    assert.equal(log.length, 2);
    assert.equal(log[0].action, 'revoke'); assert.equal(log[0].reason, 'chargeback');
  } finally { d.close(); }
});

test('delivery marks events delivered exactly once', async () => {
  const d = db(); const e = new Entitlements(d); try {
    e.adminGrant('a@x', 'u@x', 'terminow-premium', 30, 'r', 1000);
    assert.equal(e.events('pending').length, 1);
    const seen = [];
    const r = await e.deliver(async ev => { seen.push(ev.eventId); }, 2000);
    assert.equal(r.delivered, 1); assert.equal(seen.length, 1);
    assert.equal(e.events('pending').length, 0);
    assert.equal(e.events('delivered').length, 1);
    assert.equal((await e.deliver(async () => { throw new Error('x'); }, 3000)).scanned, 0); // already delivered
  } finally { d.close(); }
});

test('failed delivery backs off, resumes after restart, and force-retry succeeds', async () => {
  const d = db(); const e = new Entitlements(d); try {
    e.adminGrant('a@x', 'u@x', 'terminow-premium', 30, 'r', 1000);
    let down = true;
    const deliver = async () => { if (down) throw new Error('endpoint down'); };
    await e.deliver(deliver, 2000);
    let ev = e.events()[0];
    assert.equal(ev.status, 'pending'); assert.equal(ev.attempts, 1);
    assert.ok(ev.next_attempt > 2000); assert.match(ev.last_error, /endpoint down/);
    assert.equal((await e.deliver(deliver, 2001)).scanned, 0); // not due yet
    // Simulate a process restart: a fresh instance over the same durable DB still sees the event.
    const e2 = new Entitlements(d);
    await e2.deliver(deliver, ev.next_attempt);
    assert.equal(e2.events()[0].attempts, 2);
    down = false;
    assert.equal(e2.retry(ev.event_id, 9999), true);
    assert.equal((await e2.deliver(deliver, 9999)).delivered, 1);
    assert.equal(e2.events('delivered').length, 1);
  } finally { d.close(); }
});
