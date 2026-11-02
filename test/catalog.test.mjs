import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/migrations.mjs';
import { Catalog } from '../src/catalog.mjs';

function db() { const d = new DatabaseSync(':memory:'); migrate(d); return d; }

test('seeded catalog lists the three active products', () => {
  const d = db(); try {
    const list = new Catalog(d).list();
    assert.equal(list.length, 3);
    assert.ok(list.find(p => p.id === 'terminow-premium-30d' && p.feature_key === 'terminow-premium'));
    assert.ok(list.find(p => p.id === 'addon-network-scan' && p.days === null));
  } finally { d.close(); }
});

test('upsert validates ids, kinds, days and amounts', () => {
  const d = db(); const c = new Catalog(d); try {
    c.upsert({ id: 'addon-x', kind: 'addon', name: 'X add-on', feature_key: 'addon-x', amount: '1000' });
    assert.equal(c.get('addon-x').active, 1);
    assert.throws(() => c.upsert({ id: 'Bad Id', kind: 'addon', name: 'x', feature_key: 'f', amount: '1' }), /product id/);
    assert.throws(() => c.upsert({ id: 'sub-x', kind: 'subscription', name: 'x', feature_key: 'subx', amount: '1' }), /days/);
    assert.throws(() => c.upsert({ id: 'addon-y', kind: 'addon', name: 'x', feature_key: 'addon-y', amount: '0' }), /amount/);
    assert.throws(() => c.upsert({ id: 'addon-z', kind: 'bogus', name: 'x', feature_key: 'addon-z', amount: '1' }), /kind/);
    assert.throws(() => c.upsert({ id: 'addon-w', kind: 'addon', name: 'x', feature_key: 'f', amount: '1' }), /feature key/);
  } finally { d.close(); }
});

test('setActive hides a product from the storefront and from purchase', () => {
  const d = db(); const c = new Catalog(d); try {
    c.setActive('addon-network-scan', 0);
    assert.equal(c.list().find(p => p.id === 'addon-network-scan'), undefined);
    assert.equal(c.list(false).find(p => p.id === 'addon-network-scan').active, 0);
    assert.throws(() => c.activeProduct('addon-network-scan'), /inactive/);
    assert.throws(() => c.setActive('missing', 1), /Unknown product/);
  } finally { d.close(); }
});
