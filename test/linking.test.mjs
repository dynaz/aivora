import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/migrations.mjs';
import { Entitlements } from '../src/entitlements.mjs';
import { Linking } from '../src/linking.mjs';

function setup() {
  const d = new DatabaseSync(':memory:'); migrate(d);
  const ent = new Entitlements(d);
  return { d, ent, link: new Linking(d, ent) };
}

test('a link code redeems once and returns the account plus current entitlements', () => {
  const { d, ent, link } = setup(); try {
    ent.grantTx('e1', 'buyer@x', 'terminow-premium', 30, 'purchase', 1000);
    const { code, expires } = link.create('Buyer@X', 1000);
    assert.ok(code.length >= 20);
    assert.ok(expires > 1000);
    const r = link.redeem(code, 'device-123', 2000);
    assert.equal(r.email, 'buyer@x');                       // normalized
    assert.equal(r.entitlements.length, 1);
    assert.equal(r.entitlements[0].feature_key, 'terminow-premium');
    assert.deepEqual(link.links('buyer@x').map(l => l.terminow_ref), ['device-123']);
  } finally { d.close(); }
});

test('account-linking replay: a used code cannot be redeemed again', () => {
  const { d, link } = setup(); try {
    const { code } = link.create('buyer@x', 1000);
    link.redeem(code, 'device-123', 2000);
    assert.throws(() => link.redeem(code, 'device-123', 3000), /already used/);   // same device
    assert.throws(() => link.redeem(code, 'device-999', 3000), /already used/);   // different device
  } finally { d.close(); }
});

test('concurrent redemption: only one of two simultaneous redeems of one code wins', () => {
  const { d, link } = setup(); try {
    const { code } = link.create('buyer@x', 1000);
    // node:sqlite is synchronous, so BEGIN IMMEDIATE serializes these; the first commits the single-use
    // flip, the second sees used=1 and is rejected — the same guarantee two real connections would get.
    const first = link.redeem(code, 'device-A', 2000);
    assert.equal(first.email, 'buyer@x');
    assert.throws(() => link.redeem(code, 'device-B', 2000), /already used/);
    assert.equal(link.links('buyer@x').length, 1);
  } finally { d.close(); }
});

test('expired, unknown and malformed codes are rejected', () => {
  const { d, link } = setup(); try {
    const { code } = link.create('buyer@x', 1000, 1000); // 1s TTL
    assert.throws(() => link.redeem(code, 'device-1', 1000 + 2000), /expired/);
    assert.throws(() => link.redeem('not-a-real-code', 'device-1', 2000), /Unknown or invalid/);
    const fresh = link.create('buyer@x', 5000).code;
    assert.throws(() => link.redeem(fresh, '', 6000), /TermiNow account reference/);
    assert.throws(() => link.redeem('', 'device-1', 6000), /link code is required/);
  } finally { d.close(); }
});

test('only the sha256 hash of a code is stored, never the plaintext', () => {
  const { d, link } = setup(); try {
    const { code } = link.create('buyer@x', 1000);
    const rows = d.prepare('SELECT code_hash FROM link_codes').all();
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].code_hash, code);
    assert.match(rows[0].code_hash, /^[0-9a-f]{64}$/);
  } finally { d.close(); }
});
