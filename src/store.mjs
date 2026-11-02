// Generalized Devnet storefront orders for any catalog product (Premium subscriptions and permanent
// add-ons). Mirrors the hardened premium sandbox: a 15-minute quote, server-side verification of an
// exact SPL transferChecked + memo on Devnet, a globally-unique payment signature, and an idempotent
// entitlement grant + outbox enqueue in one transaction. No mainnet, no real payments.
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(db, catalog, entitlements, config) {
    this.db = db; this.catalog = catalog; this.entitlements = entitlements; this.config = config;
  }

  create(email, productId, payer, now = Date.now()) {
    if (!this.config.mint || !this.config.destination) throw new Error('Devnet mint and recipient token account are not configured');
    if (typeof payer !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payer)) throw new Error('Valid payer wallet required');
    const product = this.catalog.activeProduct(productId);
    const order = {
      id: randomUUID(), email, payer, product_id: product.id, feature_key: product.feature_key,
      days: product.days, amount: product.amount, mint: this.config.mint, destination: this.config.destination,
      created: now, expires: now + 15 * 60000, signature: null,
    };
    this.db.prepare('INSERT INTO store_orders(id,email,payer,product_id,feature_key,days,amount,mint,destination,created,expires,signature) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(order.id, order.email, order.payer, order.product_id, order.feature_key, order.days, order.amount, order.mint, order.destination, order.created, order.expires, null);
    return this.public(order);
  }

  // Shape the solana.mjs verifier expects (id, payer, mint, destination, amount, created, expires) plus
  // the public quote fields. Email is never exposed.
  public(order) {
    return {
      id: order.id, payer: order.payer, productId: order.product_id, featureKey: order.feature_key,
      days: order.days, amount: order.amount, mint: order.mint, destination: order.destination,
      created: order.created, expires: order.expires, network: 'devnet', decimals: 6,
      memo: 'aivora:' + order.id, sandbox: true,
    };
  }

  get(email, id) {
    const order = this.db.prepare('SELECT * FROM store_orders WHERE id=? AND email=?').get(id, email);
    if (!order) throw new Error('Order not found');
    return order;
  }

  status(email) { return { sandbox: true, entitlements: this.entitlements.list(email) }; }

  async redeem(email, id, signature, verify, now = Date.now()) {
    const order = this.get(email, id);
    if (order.signature) { if (order.signature !== signature) throw new Error('Order already paid'); return this.result(order, email); }
    await verify(order, signature);                       // RPC verification before any DB write
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const latest = this.get(email, id);
      if (latest.signature) {
        if (latest.signature !== signature) throw new Error('Order already paid');
        this.db.exec('COMMIT'); return this.result(latest, email);
      }
      // UNIQUE(signature) prevents the same payment crediting a second order.
      this.db.prepare('UPDATE store_orders SET signature=? WHERE id=?').run(signature, id);
      const expires = this.entitlements.grantTx('order:' + id, email, order.feature_key, order.days, 'purchase', now);
      this.db.exec('COMMIT');
      return { productId: order.product_id, featureKey: order.feature_key, expires, sandbox: true };
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  result(order, email) {
    const row = this.db.prepare('SELECT expires FROM entitlements WHERE email=? AND feature_key=?').get(email, order.feature_key);
    return { productId: order.product_id, featureKey: order.feature_key, expires: row ? row.expires : null, sandbox: true };
  }
}
