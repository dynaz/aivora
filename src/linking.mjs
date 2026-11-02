// Account linking: bind a TermiNow app install to a store account via a short-lived, single-use code.
//
// Flow: an authenticated store user mints a code (create). The TermiNow backend redeems it once
// (redeem), which records the link and returns the store identity plus the user's current entitlements;
// future entitlement changes arrive through the delivery outbox, keyed by the same email. The code is
// high-entropy and only its sha256 hash is persisted, so a database read never reveals a usable code.
// Single use and expiry are enforced atomically so a code cannot be replayed or redeemed concurrently.
import { randomBytes, createHash } from 'node:crypto';

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const hash = code => createHash('sha256').update(String(code)).digest('hex');

export class Linking {
  constructor(db, entitlements = null) { this.db = db; this.entitlements = entitlements; }

  // Mint a code for an authenticated user. Returns { code, expires }. The caller shows `code` to the
  // user to enter into the TermiNow app; it is the only time the plaintext exists.
  create(email, now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
    if (typeof email !== 'string' || !email.trim()) throw new Error('A user is required');
    const code = randomBytes(18).toString('base64url'); // ~144 bits
    const expires = now + ttlMs;
    this.db.prepare('INSERT INTO link_codes(code_hash,email,created,expires,used) VALUES (?,?,?,?,0)')
      .run(hash(code), email.trim().toLowerCase(), now, expires);
    return { code, expires };
  }

  // Redeem a code on behalf of a TermiNow reference. Atomic single-use + expiry. Returns
  // { email, entitlements } (entitlements only when an Entitlements instance was provided). Throws on an
  // unknown, expired or already-used code — a replay of a used code always fails here.
  redeem(code, terminowRef, now = Date.now()) {
    if (typeof code !== 'string' || !code) throw new Error('A link code is required');
    if (typeof terminowRef !== 'string' || !terminowRef.trim()) throw new Error('A TermiNow account reference is required');
    const ref = terminowRef.trim();
    const h = hash(code);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT email, expires, used FROM link_codes WHERE code_hash=?').get(h);
      if (!row) throw new Error('Unknown or invalid link code');
      if (now > row.expires) throw new Error('Link code expired');
      // Only an unused row is affected; a replay or a concurrent redeem sees changes===0 and is rejected.
      const upd = this.db.prepare('UPDATE link_codes SET used=1, used_at=?, terminow_ref=? WHERE code_hash=? AND used=0')
        .run(now, ref, h);
      if (upd.changes !== 1) throw new Error('Link code already used');
      this.db.prepare('INSERT OR IGNORE INTO account_links(email,terminow_ref,created) VALUES (?,?,?)')
        .run(row.email, ref, now);
      this.db.exec('COMMIT');
      const entitlements = this.entitlements ? this.entitlements.list(row.email) : undefined;
      return entitlements ? { email: row.email, entitlements } : { email: row.email };
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  links(email) {
    return this.db.prepare('SELECT terminow_ref, created FROM account_links WHERE email=? ORDER BY created')
      .all((email || '').trim().toLowerCase());
  }
}
