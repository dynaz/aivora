// Entitlements, the server-to-server delivery outbox, and the admin audit log.
//
// An entitlement is a per-user feature grant with an optional expiry (NULL = permanent). Delivery to
// TermiNow is decoupled through an outbox: every grant/revoke writes an entitlement_events row with an
// idempotent event_id, and a worker (deliver) drains it with exponential backoff. Events are durable,
// so delivery resumes after a process restart. The admin key / endpoint live only on the server; the
// mobile app never carries them.
import { randomUUID } from 'node:crypto';

const MAX_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 3600000;

export class Entitlements {
  constructor(db) { this.db = db; }

  list(email) {
    return this.db.prepare('SELECT feature_key, expires, source, updated FROM entitlements WHERE email=? ORDER BY feature_key').all(email);
  }

  active(email, featureKey, now = Date.now()) {
    const row = this.db.prepare('SELECT expires FROM entitlements WHERE email=? AND feature_key=?').get(email, featureKey);
    if (!row) return false;
    return row.expires === null || row.expires > now;
  }

  // Grant or extend WITHIN the caller's open transaction. Subscriptions (days>0) extend from the later
  // of the current expiry and now; add-ons (days falsy) are permanent (expires NULL). Enqueues the
  // outbox event under the caller-supplied idempotent eventId. Returns the new expiry (or null).
  grantTx(eventId, email, featureKey, days, source, now = Date.now()) {
    const current = this.db.prepare('SELECT expires FROM entitlements WHERE email=? AND feature_key=?').get(email, featureKey);
    let expires;
    if (!days) expires = null;                          // permanent add-on
    else expires = Math.max(now, current?.expires || 0) + days * 86400000;
    // A permanent grant must not be downgraded to an expiring one.
    if (current && current.expires === null) expires = null;
    this.db.prepare(`INSERT INTO entitlements(email,feature_key,expires,source,updated) VALUES (?,?,?,?,?)
      ON CONFLICT(email,feature_key) DO UPDATE SET expires=excluded.expires, source=excluded.source, updated=excluded.updated`)
      .run(email, featureKey, expires, source, now);
    this.#enqueue(eventId, email, featureKey, 'grant', { expires, source }, now);
    return expires;
  }

  // Revoke WITHIN the caller's open transaction and enqueue a revoke event.
  revokeTx(eventId, email, featureKey, now = Date.now()) {
    this.db.prepare('DELETE FROM entitlements WHERE email=? AND feature_key=?').run(email, featureKey);
    this.#enqueue(eventId, email, featureKey, 'revoke', {}, now);
  }

  #enqueue(eventId, email, featureKey, kind, payload, now) {
    // INSERT OR IGNORE keeps enqueue idempotent: a retried redemption cannot create a duplicate event.
    this.db.prepare(`INSERT OR IGNORE INTO entitlement_events(event_id,email,feature_key,kind,payload,status,attempts,next_attempt,created)
      VALUES (?,?,?,?,?, 'pending', 0, ?, ?)`).run(eventId, email, featureKey, kind, JSON.stringify(payload), now, now);
  }

  // Standalone admin grant/revoke (own transaction) with an audit entry. Reason is required.
  adminGrant(actor, email, featureKey, days, reason, now = Date.now()) {
    if (!reason || !reason.trim()) throw new Error('A reason is required');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const expires = this.grantTx('grant:' + randomUUID(), email, featureKey, days, 'grant', now);
      this.#audit(actor, 'grant', email + ':' + featureKey, reason, { days: days || null, expires }, now);
      this.db.exec('COMMIT');
      return expires;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  adminRevoke(actor, email, featureKey, reason, now = Date.now()) {
    if (!reason || !reason.trim()) throw new Error('A reason is required');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.revokeTx('revoke:' + randomUUID(), email, featureKey, now);
      this.#audit(actor, 'revoke', email + ':' + featureKey, reason, {}, now);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  #audit(actor, action, subject, reason, detail, now) {
    this.db.prepare('INSERT INTO audit_log(ts,actor,action,subject,reason,detail) VALUES (?,?,?,?,?,?)')
      .run(now, actor, action, subject, reason || null, JSON.stringify(detail));
  }

  auditLog(limit = 100) {
    return this.db.prepare('SELECT id,ts,actor,action,subject,reason,detail FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
  }

  // Outbox views for the admin delivery-retry screen.
  events(status, limit = 100) {
    if (status) return this.db.prepare('SELECT * FROM entitlement_events WHERE status=? ORDER BY next_attempt LIMIT ?').all(status, limit);
    return this.db.prepare('SELECT * FROM entitlement_events ORDER BY next_attempt LIMIT ?').all(limit);
  }

  // Admin-forced retry: re-queue a failed/pending event immediately.
  retry(eventId, now = Date.now()) {
    const r = this.db.prepare("UPDATE entitlement_events SET status='pending', next_attempt=?, last_error=NULL WHERE event_id=? AND status!='delivered'").run(now, eventId);
    return r.changes > 0;
  }

  // Drain due events once. deliverFn(event) resolves on success and throws on failure. Idempotent on the
  // delivery side via event_id. Safe to call periodically and after restart.
  async deliver(deliverFn, now = Date.now(), limit = 25) {
    const due = this.db.prepare("SELECT * FROM entitlement_events WHERE status='pending' AND next_attempt<=? ORDER BY next_attempt LIMIT ?").all(now, limit);
    let delivered = 0, failed = 0;
    for (const ev of due) {
      try {
        await deliverFn({ eventId: ev.event_id, email: ev.email, featureKey: ev.feature_key, kind: ev.kind, ...JSON.parse(ev.payload) });
        this.db.prepare("UPDATE entitlement_events SET status='delivered', delivered=?, last_error=NULL WHERE event_id=?").run(Date.now(), ev.event_id);
        delivered++;
      } catch (e) {
        const attempts = ev.attempts + 1;
        const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempts);
        const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
        this.db.prepare('UPDATE entitlement_events SET attempts=?, next_attempt=?, last_error=?, status=? WHERE event_id=?')
          .run(attempts, Date.now() + backoff, String(e && e.message || e).slice(0, 500), status, ev.event_id);
        failed++;
      }
    }
    return { delivered, failed, scanned: due.length };
  }
}
