import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/migrations.mjs';
import { Admins, orders, reconcile } from '../src/admin.mjs';

function db() { const d = new DatabaseSync(':memory:'); migrate(d); return d; }

test('admin roles are set (case-insensitive), read, listed and removed; bad role rejected', () => {
  const d = db(); const a = new Admins(d); try {
    assert.equal(a.isAdmin('x@y.com'), false);
    a.setRole('X@Y.com', 'admin');
    assert.equal(a.role('x@y.com'), 'admin');
    a.setRole('x@y.com', 'superadmin');
    assert.equal(a.role('x@y.com'), 'superadmin');
    assert.throws(() => a.setRole('z@y.com', 'owner'), /Role/);
    assert.throws(() => a.setRole('', 'admin'), /Email/);
    assert.equal(a.list().length, 1);
    assert.equal(a.remove('x@y.com'), true);
    assert.equal(a.isAdmin('x@y.com'), false);
  } finally { d.close(); }
});

test('reconcile flags a paid order with no entitlement and lists undelivered events', () => {
  const d = db(); try {
    d.prepare('INSERT INTO store_orders(id,email,payer,product_id,feature_key,days,amount,mint,destination,created,expires,signature) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('o1', 'u@x', 'pay', 'terminow-premium-30d', 'terminow-premium', 30, '10000000', 'm', 'r', 1, 2, 'sigA');
    d.prepare("INSERT INTO entitlement_events(event_id,email,feature_key,kind,payload,status,attempts,next_attempt,created) VALUES ('e1','u@x','terminow-premium','grant','{}','pending',0,0,0)").run();
    const r = reconcile(d);
    assert.equal(r.paidOrders, 1);
    assert.equal(r.anomalies.length, 1);
    assert.match(r.anomalies[0].issue, /without a matching entitlement/);
    assert.equal(r.undelivered.length, 1);
    assert.equal(r.undelivered[0].event_id, 'e1');
    assert.deepEqual(orders(d).store.map(o => o.id), ['o1']);
  } finally { d.close(); }
});
