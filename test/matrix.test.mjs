// Consolidated acceptance matrix for the store/payment/entitlement flows. Each test names a required
// scenario. Payment verification itself is Devnet/RPC-shaped and unit-tested in solana.test.mjs; here the
// verifier is stubbed so these tests exercise order/entitlement/outbox behavior deterministically.
// Nothing here makes a real payment, touches mainnet, or performs a production grant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/migrations.mjs';
import { Catalog } from '../src/catalog.mjs';
import { Entitlements } from '../src/entitlements.mjs';
import { Store } from '../src/store.mjs';

const CONFIG = { mint: 'MINT', destination: 'DEST' };
const PAYER = '11111111111111111111111111111111'; // 32 base58 chars
const ok = async () => {};                          // payment verifier: succeeds
const fail = async () => { throw new Error('payment not found'); };

function setup() {
  const d = new DatabaseSync(':memory:'); migrate(d);
  const catalog = new Catalog(d);
  const ent = new Entitlements(d);
  const store = new Store(d, catalog, ent, CONFIG);
  return { d, catalog, ent, store };
}

test('cross-user access denial: a user cannot see or redeem another user\'s order', async () => {
  const { d, store } = setup(); try {
    const o = store.create('buyer@x', 'addon-network-scan', PAYER, 1000);
    assert.throws(() => store.get('attacker@x', o.id), /not found/);
    await assert.rejects(() => store.redeem('attacker@x', o.id, 'sigZ', ok), /not found/);
    // The legitimate owner still can.
    await assert.doesNotReject(() => store.redeem('buyer@x', o.id, 'sigA', ok));
  } finally { d.close(); }
});

test('duplicate permanent purchase stays permanent and is never downgraded', async () => {
  const { d, store, ent } = setup(); try {
    const o1 = store.create('buyer@x', 'addon-network-scan', PAYER, 1000);
    await store.redeem('buyer@x', o1.id, 'sig1', ok, 1000);
    const o2 = store.create('buyer@x', 'addon-network-scan', PAYER, 2000);
    const r2 = await store.redeem('buyer@x', o2.id, 'sig2', ok, 2000);
    assert.equal(r2.expires, null);                                  // still permanent
    const list = ent.list('buyer@x');
    assert.equal(list.length, 1);                                    // one entitlement, not two
    assert.equal(list[0].expires, null);
    assert.equal(ent.active('buyer@x', 'addon-network-scan'), true);
  } finally { d.close(); }
});

test('transaction reuse: one payment signature cannot credit a second order', async () => {
  const { d, store, ent } = setup(); try {
    const o1 = store.create('buyer@x', 'addon-network-scan', PAYER, 1000);
    const o2 = store.create('buyer@x', 'addon-network-scan', PAYER, 1000);
    await store.redeem('buyer@x', o1.id, 'shared-sig', ok, 1000);
    await assert.rejects(() => store.redeem('buyer@x', o2.id, 'shared-sig', ok, 1000)); // UNIQUE(signature)
    assert.equal(d.prepare('SELECT COUNT(*) c FROM store_orders WHERE signature=?').get('shared-sig').c, 1);
  } finally { d.close(); }
});

test('redeeming the same order twice with the same signature is idempotent', async () => {
  const { d, store, ent } = setup(); try {
    const o = store.create('buyer@x', 'terminow-premium-30d', PAYER, 1000);
    const a = await store.redeem('buyer@x', o.id, 'sig', ok, 1000);
    const b = await store.redeem('buyer@x', o.id, 'sig', ok, 1000);
    assert.deepEqual(a, b);
    assert.equal(ent.list('buyer@x').length, 1);
    assert.equal(d.prepare("SELECT COUNT(*) c FROM entitlement_events WHERE event_id=?").get('order:' + o.id).c, 1);
  } finally { d.close(); }
});

test('subscription extension: a second subscription extends from the current expiry', async () => {
  const { d, store, ent } = setup(); try {
    const DAY = 86400000;
    const o1 = store.create('buyer@x', 'terminow-premium-30d', PAYER, 1000);
    const r1 = await store.redeem('buyer@x', o1.id, 'sig1', ok, 1000);
    assert.equal(r1.expires, 1000 + 30 * DAY);
    // Buy again 10 days in: extend from the existing expiry, not from "now".
    const o2 = store.create('buyer@x', 'terminow-premium-30d', PAYER, 1000 + 10 * DAY);
    const r2 = await store.redeem('buyer@x', o2.id, 'sig2', ok, 1000 + 10 * DAY);
    assert.equal(r2.expires, 1000 + 60 * DAY);
  } finally { d.close(); }
});

test('Premium bundle overlap: Premium and an add-on are independent entitlements', async () => {
  const { d, store, ent } = setup(); try {
    const op = store.create('buyer@x', 'terminow-premium-30d', PAYER, 1000);
    await store.redeem('buyer@x', op.id, 'sigp', ok, 1000);
    const oa = store.create('buyer@x', 'addon-network-scan', PAYER, 1000);
    await store.redeem('buyer@x', oa.id, 'siga', ok, 1000);
    const byKey = Object.fromEntries(ent.list('buyer@x').map(e => [e.feature_key, e]));
    assert.equal(ent.active('buyer@x', 'terminow-premium', 1000), true);
    assert.equal(ent.active('buyer@x', 'addon-network-scan', 1000), true);
    assert.notEqual(byKey['terminow-premium'].expires, null);  // subscription expires
    assert.equal(byKey['addon-network-scan'].expires, null);   // add-on permanent, unaffected by Premium
  } finally { d.close(); }
});

test('revocation removes the entitlement, audits the reason, and enqueues a revoke event', async () => {
  const { d, store, ent } = setup(); try {
    const o = store.create('buyer@x', 'terminow-premium-30d', PAYER, 1000);
    await store.redeem('buyer@x', o.id, 'sig', ok, 1000);
    assert.equal(ent.active('buyer@x', 'terminow-premium', 1000), true);
    ent.adminRevoke('admin@x', 'buyer@x', 'terminow-premium', 'refund issued', 2000);
    assert.equal(ent.active('buyer@x', 'terminow-premium', 2000), false);
    assert.ok(ent.auditLog().find(a => a.action === 'revoke' && a.reason === 'refund issued'));
    assert.ok(ent.events().find(e => e.kind === 'revoke' && e.feature_key === 'terminow-premium'));
  } finally { d.close(); }
});

test('consumable retry: a retried redemption grants once (idempotent outbox event)', async () => {
  const { d, catalog, ent } = setup(); try {
    catalog.upsert({ id: 'credit-pack', kind: 'consumable', name: 'Credit pack', feature_key: 'credit-pack', days: null, amount: '1000000' });
    // Simulate two redemption attempts for the same order (a retry): same idempotent event id.
    ent.grantTx('order:cp-1', 'buyer@x', 'credit-pack', null, 'purchase', 1000);
    ent.grantTx('order:cp-1', 'buyer@x', 'credit-pack', null, 'purchase', 1000);
    assert.equal(d.prepare("SELECT COUNT(*) c FROM entitlement_events WHERE event_id=?").get('order:cp-1').c, 1);
    assert.equal(ent.list('buyer@x').length, 1);
  } finally { d.close(); }
});

test('delivery retry after process restart: a failed event is redelivered once by a fresh instance', async () => {
  const d = new DatabaseSync(':memory:'); migrate(d); try {
    new Entitlements(d).grantTx('order:r-1', 'buyer@x', 'terminow-premium', 30, 'purchase', 1000);

    // First run: delivery endpoint is down → the event is left pending with a future next_attempt.
    const run1 = new Entitlements(d);
    let r = await run1.deliver(fail, 1000);
    assert.equal(r.delivered, 0);
    assert.equal(r.failed, 1);
    const ev = run1.events('pending')[0];
    assert.equal(ev.attempts, 1);
    assert.ok(ev.next_attempt > 1000);

    // "Restart": a brand-new instance on the same durable DB resumes the outbox. Admin-forced retry
    // makes it due now; delivery succeeds exactly once.
    const run2 = new Entitlements(d);
    assert.equal(run2.retry('order:r-1', 2000), true);
    let calls = 0;
    r = await run2.deliver(async () => { calls++; }, 2000);
    assert.equal(r.delivered, 1);
    assert.equal(calls, 1);
    assert.equal(run2.events('delivered').length, 1);
    assert.equal(run2.events('pending').length, 0);
    // A further drain delivers nothing more (no duplicate delivery).
    r = await run2.deliver(async () => { calls++; }, 3000);
    assert.equal(calls, 1);
  } finally { d.close(); }
});
