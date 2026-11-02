// The product catalog: TermiNow Premium subscriptions and individual feature add-ons. Admin-managed;
// the storefront reads the active list. Prices are raw SPL base units (6 decimals), Devnet test values.
const DECIMAL = /^[0-9]{1,20}$/;
const KINDS = new Set(['subscription', 'addon', 'consumable']);

function validate(p) {
  if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(p.id)) throw new Error('Invalid product id');
  if (!KINDS.has(p.kind)) throw new Error('Invalid product kind');
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 120) throw new Error('Invalid product name');
  if (p.description != null && (typeof p.description !== 'string' || p.description.length > 500)) throw new Error('Invalid description');
  if (typeof p.feature_key !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(p.feature_key)) throw new Error('Invalid feature key');
  if (typeof p.amount !== 'string' || !DECIMAL.test(p.amount) || p.amount === '0') throw new Error('Invalid amount');
  if (p.kind === 'subscription') {
    if (!Number.isInteger(p.days) || p.days <= 0 || p.days > 36500) throw new Error('Subscription requires positive days');
  } else if (p.days != null && p.days !== 0) {
    throw new Error('Non-subscription products do not take days');
  }
}

export class Catalog {
  constructor(db) { this.db = db; }

  list(activeOnly = true) {
    const where = activeOnly ? 'WHERE active=1' : '';
    return this.db.prepare(`SELECT id,kind,name,description,days,feature_key,amount,active FROM products ${where} ORDER BY kind, CAST(amount AS INTEGER)`).all();
  }

  get(id) { return this.db.prepare('SELECT * FROM products WHERE id=?').get(id); }

  activeProduct(id) {
    const p = this.get(id);
    if (!p || !p.active) throw new Error('Unknown or inactive product');
    return p;
  }

  upsert(p) {
    const product = { ...p, description: p.description || '', days: p.kind === 'subscription' ? p.days : null };
    validate(product);
    this.db.prepare(`INSERT INTO products(id,kind,name,description,days,feature_key,amount,active) VALUES (?,?,?,?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,name=excluded.name,description=excluded.description,days=excluded.days,feature_key=excluded.feature_key,amount=excluded.amount`)
      .run(product.id, product.kind, product.name, product.description, product.days, product.feature_key, product.amount);
    return this.get(product.id);
  }

  setActive(id, active) {
    const r = this.db.prepare('UPDATE products SET active=? WHERE id=?').run(active ? 1 : 0, id);
    if (!r.changes) throw new Error('Unknown product');
  }
}
