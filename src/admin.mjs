// Admin role model (RBAC) plus read models for order inspection and payment reconciliation.
//
// Admin roles live in the `admins` table and are assigned ONLY out-of-band via scripts/admin.mjs — there
// is deliberately no API or signup path to grant oneself admin. Manual entitlement grants/revocations go
// through Entitlements.adminGrant/adminRevoke, which require a reason and write the audit log.
const ROLES = new Set(['admin', 'superadmin']);

export class Admins {
  constructor(db) { this.db = db; }

  role(email) { return this.db.prepare('SELECT role FROM admins WHERE email=?').get(email)?.role; }
  isAdmin(email) { return !!this.role(email); }
  list() { return this.db.prepare('SELECT email, role FROM admins ORDER BY email').all(); }

  setRole(email, role) {
    if (typeof email !== 'string' || !email.trim()) throw new Error('Email required');
    if (!ROLES.has(role)) throw new Error('Role must be admin or superadmin');
    this.db.prepare('INSERT INTO admins(email,role) VALUES (?,?) ON CONFLICT(email) DO UPDATE SET role=excluded.role')
      .run(email.trim().toLowerCase(), role);
  }

  remove(email) {
    return this.db.prepare('DELETE FROM admins WHERE email=?').run((email || '').trim().toLowerCase()).changes > 0;
  }
}

// Recent orders across both the generalized store and the legacy premium flow, for inspection. Emails
// are included (admin-only view); payment signatures are shown for reconciliation.
export function orders(db, limit = 100) {
  const store = db.prepare('SELECT id,email,payer,product_id,feature_key,days,amount,created,expires,signature FROM store_orders ORDER BY created DESC LIMIT ?').all(limit);
  // The legacy premium_orders table is created by the Premium class, not by migrate(); treat its absence
  // (e.g. a store-only database) as an empty premium order list rather than an error.
  const hasPremium = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='premium_orders'").get();
  const premium = hasPremium
    ? db.prepare('SELECT id,email,payer,plan,days,amount,created,expires,signature FROM premium_orders ORDER BY created DESC LIMIT ?').all(limit)
    : [];
  return { store, premium };
}

// Payment reconciliation: every paid store order should have produced an entitlement, and every outbox
// event should eventually deliver. Returns anomalies for an admin to act on — it never changes state.
export function reconcile(db) {
  const paid = db.prepare('SELECT id,email,feature_key FROM store_orders WHERE signature IS NOT NULL').all();
  const anomalies = [];
  for (const o of paid) {
    const ent = db.prepare('SELECT 1 FROM entitlements WHERE email=? AND feature_key=?').get(o.email, o.feature_key);
    if (!ent) anomalies.push({ order: o.id, email: o.email, issue: 'paid order without a matching entitlement' });
  }
  const undelivered = db.prepare("SELECT event_id,email,feature_key,kind,status,attempts,last_error FROM entitlement_events WHERE status!='delivered' ORDER BY next_attempt").all();
  return { paidOrders: paid.length, anomalies, undelivered };
}
