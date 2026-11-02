// Ordered, idempotent schema migrations tracked in schema_migrations. Each runs once, inside a
// transaction; a failure rolls back and aborts startup (fail-safe). The legacy tables created inline by
// Accounts/Premium remain; these migrations add the storefront catalog, entitlements, the delivery
// outbox, admin roles and the audit log. Seeds use Devnet test prices only — no mainnet, no real money.

export const SEED_PRODUCTS = [
  { id: 'terminow-premium-30d', kind: 'subscription', name: 'TermiNow Premium — 30 days', description: 'Premium for 30 days.', days: 30, feature_key: 'terminow-premium', amount: '10000000' },
  { id: 'terminow-premium-365d', kind: 'subscription', name: 'TermiNow Premium — 365 days', description: 'Premium for 365 days.', days: 365, feature_key: 'terminow-premium', amount: '100000000' },
  { id: 'addon-network-scan', kind: 'addon', name: 'Network Scan add-on', description: 'Permanent Network Scan feature unlock.', days: null, feature_key: 'addon-network-scan', amount: '5000000' },
];

export const migrations = [
  {
    id: '001-storefront',
    up: db => db.exec(`
      CREATE TABLE IF NOT EXISTS products(
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('subscription','addon','consumable')),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        days INTEGER,
        feature_key TEXT NOT NULL,
        amount TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));

      CREATE TABLE IF NOT EXISTS entitlements(
        email TEXT NOT NULL,
        feature_key TEXT NOT NULL,
        expires INTEGER,                      -- NULL = permanent
        source TEXT NOT NULL,                 -- 'purchase' | 'grant'
        updated INTEGER NOT NULL,
        PRIMARY KEY(email, feature_key));

      CREATE TABLE IF NOT EXISTS entitlement_events(
        event_id TEXT PRIMARY KEY,            -- idempotency key; one row per logical delivery
        email TEXT NOT NULL,
        feature_key TEXT NOT NULL,
        kind TEXT NOT NULL,                   -- 'grant' | 'revoke'
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt INTEGER NOT NULL,
        last_error TEXT,
        created INTEGER NOT NULL,
        delivered INTEGER);

      CREATE TABLE IF NOT EXISTS store_orders(
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        payer TEXT NOT NULL,
        product_id TEXT NOT NULL,
        feature_key TEXT NOT NULL,
        days INTEGER,
        amount TEXT NOT NULL,
        mint TEXT NOT NULL,
        destination TEXT NOT NULL,
        created INTEGER NOT NULL,
        expires INTEGER NOT NULL,
        signature TEXT UNIQUE);

      CREATE TABLE IF NOT EXISTS admins(
        email TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK(role IN ('admin','superadmin')));

      CREATE TABLE IF NOT EXISTS audit_log(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        subject TEXT,
        reason TEXT,
        detail TEXT);

      CREATE INDEX IF NOT EXISTS idx_events_due ON entitlement_events(status, next_attempt);
      CREATE INDEX IF NOT EXISTS idx_entitlements_email ON entitlements(email);`),
  },
  {
    id: '002-seed-catalog',
    up: db => {
      const insert = db.prepare('INSERT OR IGNORE INTO products(id,kind,name,description,days,feature_key,amount,active) VALUES (?,?,?,?,?,?,?,1)');
      for (const p of SEED_PRODUCTS) insert.run(p.id, p.kind, p.name, p.description, p.days, p.feature_key, p.amount);
    },
  },
];

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = [];
  for (const m of migrations) {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get(m.id)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(m.id, Date.now());
      db.exec('COMMIT');
      applied.push(m.id);
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return applied;
}
