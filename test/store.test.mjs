import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/migrations.mjs';
import { Catalog } from '../src/catalog.mjs';
import { Entitlements } from '../src/entitlements.mjs';
import { Store } from '../src/store.mjs';

const payer = '1'.repeat(40);
function db() { const d = new DatabaseSync(':memory:'); migrate(d); return d; }
function store(d) { return new Store(d, new Catalog(d), new Entitlements(d), { mint: 'mint', destination: 'recipient' }); }

test('order creation requires config, a valid payer and an active product', () => {
  const d = db(); try {
    assert.throws(() => new Store(d, new Catalog(d), new Entitlements(d), {}).create('u', 'terminow-premium-30d', payer), /configured/);
    const s = store(d);
    assert.throws(() => s.create('u', 'terminow-premium-30d', 'not a wallet'), /payer/);
    assert.throws(() => s.create('u', 'does-not-exist', payer), /Unknown or inactive/);
  } finally { d.close(); }
});

test('subscription redeem grants an extending entitlement and enqueues one idempotent event', async () => {
  const d = db(); const s = store(d); try {
    const o = s.create('u@x', 'terminow-premium-30d', payer, 1000);
    assert.equal(o.featureKey, 'terminow-premium');
    assert.equal(o.amount, '10000000');
    assert.equal(o.memo, 'aivora:' + o.id);
    const sig = '2'.repeat(88);
    const r = await s.redeem('u@x', o.id, sig, async () => {}, 1000000);
    assert.equal(r.expires, 1000000 + 30 * 86400000);
    assert.deepEqual(await s.redeem('u@x', o.id, sig, async () => {}, 2000000), r); // idempotent replay
    const ent = new Entitlements(d);
    assert.equal(ent.active('u@x', 'terminow-premium', 1000000), true);
    assert.equal(ent.events().length, 1);
    assert.equal(ent.events()[0].event_id, 'order:' + o.id);
  } finally { d.close(); }
});

test('permanent add-on grants a non-expiring entitlement', async () => {
  const d = db(); const s = store(d); try {
    const o = s.create('u@x', 'addon-network-scan', payer, 1000);
    assert.equal(o.days, null);
    const r = await s.redeem('u@x', o.id, '3'.repeat(88), async () => {}, 1000);
    assert.equal(r.expires, null);
    assert.equal(new Entitlements(d).active('u@x', 'addon-network-scan', 9_999_999_999_999), true);
  } finally { d.close(); }
});

test('one payment signature cannot credit two orders; a wrong user cannot see an order', async () => {
  const d = db(); const s = store(d); try {
    const o1 = s.create('a@x', 'terminow-premium-30d', payer, 1000);
    const o2 = s.create('a@x', 'terminow-premium-30d', payer, 1000);
    const sig = '4'.repeat(88);
    await s.redeem('a@x', o1.id, sig, async () => {}, 1000);
    await assert.rejects(s.redeem('a@x', o2.id, sig, async () => {}), /UNIQUE/);
    assert.throws(() => s.get('b@x', o1.id), /not found/);
  } finally { d.close(); }
});

test('failed verification grants nothing and enqueues nothing', async () => {
  const d = db(); const s = store(d); try {
    const o = s.create('u@x', 'terminow-premium-30d', payer, 1000);
    await assert.rejects(s.redeem('u@x', o.id, '5'.repeat(88), async () => { throw new Error('bad tx'); }));
    const ent = new Entitlements(d);
    assert.equal(ent.list('u@x').length, 0);
    assert.equal(ent.events().length, 0);
  } finally { d.close(); }
});
