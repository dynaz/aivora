import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Accounts } from './accounts.mjs';
import { generate } from './provider.mjs';
import { Premium, plans } from './premium.mjs';
import { verifyDevnetPayment } from './solana.mjs';
import { premiumPage } from './premium-page.mjs';
import { storePage } from './store-page.mjs';
import { adminPage } from './admin-page.mjs';
import { page } from './page.mjs';
import { Admins, orders as adminOrders, reconcile } from './admin.mjs';
import { loadConfig } from './config.mjs';
import { log, accessLog } from './logger.mjs';
import { newCsrfToken, csrfValid, hostAllowed, originAllowed, readCookie, cookie } from './security.mjs';
import { migrate } from './migrations.mjs';
import { Catalog } from './catalog.mjs';
import { Entitlements } from './entitlements.mjs';
import { Store } from './store.mjs';
import { makeDeliverer } from './delivery.mjs';

const config = loadConfig();
const path = resolve(process.env.AIVORA_DB || 'data/aivora.sqlite');
mkdirSync(dirname(path), { recursive: true });
const accounts = new Accounts(path);
log('info', { event: 'migrate', applied: migrate(accounts.db) });
const payConfig = { mint: process.env.AIVR_DEVNET_MINT, destination: process.env.AIVR_DEVNET_RECIPIENT_TOKEN_ACCOUNT };
const premium = new Premium(accounts.db, payConfig);
const entitlements = new Entitlements(accounts.db);
const catalog = new Catalog(accounts.db);
const store = new Store(accounts.db, catalog, entitlements, payConfig);
const admins = new Admins(accounts.db);
const deliverer = makeDeliverer(config.delivery);
const fireDelivery = () => entitlements.deliver(deliverer).catch(e => log('error', { event: 'deliver_error', message: String(e && e.message || e) }));
const attempts = new Map();

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

// Security headers applied to every response. CSP permits the demo pages' inline script/style; a later
// phase can move to nonces. frame-ancestors/X-Frame-Options block clickjacking of the auth UI.
function baseHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

// Set a readable CSRF cookie on page loads if the client has none, and hand the token back for the
// page script to echo in the X-CSRF-Token header on state-changing requests (double-submit).
function ensureCsrf(req, res) {
  let token = readCookie(req.headers.cookie, 'csrf');
  if (!token) {
    token = newCsrfToken();
    res.setHeader('Set-Cookie', cookie('csrf', token, { httpOnly: false, secure: config.secureCookies }));
  }
  return token;
}

const server = http.createServer(async (req, res) => {
  const started = process.hrtime.bigint();
  const ip = req.socket.remoteAddress;
  res.on('finish', () => {
    if (req.url === '/healthz' || req.url === '/readyz') return;
    accessLog({ method: req.method, url: req.url, status: res.statusCode, ip,
      ms: Number((process.hrtime.bigint() - started) / 1000n) / 1000 });
  });

  baseHeaders(res);
  const serverPort = server.address().port;

  // Host allow-list (canonical host and loopback). Never derived from forwarded headers.
  if (!hostAllowed(req.headers.host, config, serverPort)) return json(res, 403, { error: 'Host rejected' });

  // Liveness/readiness for systemd and the proxy. No auth; readiness touches the DB.
  if (req.method === 'GET' && req.url === '/healthz') return json(res, 200, { status: 'ok' });
  if (req.method === 'GET' && req.url === '/readyz') {
    try { accounts.db.prepare('SELECT 1').get(); return json(res, 200, { status: 'ready' }); }
    catch { return json(res, 503, { status: 'unready' }); }
  }

  if (req.method === 'GET' && req.url === '/') {
    ensureCsrf(req, res); res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(page);
  }
  if (req.method === 'GET' && req.url === '/premium') {
    ensureCsrf(req, res); res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(premiumPage);
  }
  if (req.method === 'GET' && req.url === '/store') {
    ensureCsrf(req, res); res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(storePage);
  }
  if (req.method === 'GET' && req.url === '/admin') {
    ensureCsrf(req, res); res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(adminPage);
  }
  if (req.method === 'GET' && req.url === '/api/csrf') return json(res, 200, { token: ensureCsrf(req, res) });

  const token = readCookie(req.headers.cookie, 'session') || '';
  const user = accounts.user(token);

  if (req.method === 'GET') {
    if (!user) return json(res, 401, { error: 'Please log in' });
    if (req.url === '/api/premium/plans') return json(res, 200, { sandbox: true, plans });
    if (req.url === '/api/premium/status') return json(res, 200, premium.status(user));
    if (req.url === '/api/catalog') return json(res, 200, { sandbox: true, products: catalog.list() });
    if (req.url === '/api/entitlements') return json(res, 200, { entitlements: entitlements.list(user) });
    if (req.url === '/api/store/status') return json(res, 200, store.status(user));
    if (req.url === '/api/balance') return json(res, 200, { email: user, balance: accounts.balance(user) });
    if (req.url === '/api/history') return json(res, 200, { transactions: accounts.history(user) });
    // Admin (RBAC). whoami is readable by any session; everything else requires a role.
    if (req.url === '/api/admin/whoami') return json(res, 200, { email: user, role: admins.role(user) || null });
    if (req.url.split('?')[0].startsWith('/api/admin/')) {
      if (!admins.isAdmin(user)) return json(res, 403, { error: 'Admin access required' });
      const u = new URL(req.url, 'http://local');
      if (u.pathname === '/api/admin/catalog') return json(res, 200, { products: catalog.list(false) });
      if (u.pathname === '/api/admin/orders') return json(res, 200, adminOrders(accounts.db));
      if (u.pathname === '/api/admin/reconcile') return json(res, 200, reconcile(accounts.db));
      if (u.pathname === '/api/admin/events') return json(res, 200, { events: entitlements.events(u.searchParams.get('status') || undefined) });
      if (u.pathname === '/api/admin/audit') return json(res, 200, { audit: entitlements.auditLog() });
      return json(res, 404, { error: 'Not found' });
    }
    return json(res, 404, { error: 'Not found' });
  }

  if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });

  // Cross-site protections for every state-changing request: Origin allow-list + CSRF double-submit.
  if (!originAllowed(req.headers.origin, config, serverPort)) return json(res, 403, { error: 'Origin rejected' });
  if (!csrfValid(readCookie(req.headers.cookie, 'csrf'), req.headers['x-csrf-token']))
    return json(res, 403, { error: 'CSRF token missing or invalid' });
  if (req.headers['content-type'] !== 'application/json') return json(res, 415, { error: 'JSON required' });

  try {
    let body = '', size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 8192) return json(res, 413, { error: 'Request too large' }); body += chunk; }
    const data = JSON.parse(body);
    if (!data || typeof data !== 'object') throw new Error('Invalid request');

    if (['/api/register', '/api/login'].includes(req.url)) {
      const key = ip; const now = Date.now(); let bucket = attempts.get(key);
      if (!bucket || now > bucket.until) { bucket = { count: 0, until: now + 60000 }; attempts.set(key, bucket); }
      if (++bucket.count > 10) return json(res, 429, { error: 'Try again in one minute' });
      if (req.url === '/api/register') { accounts.register(data.email, data.password); return json(res, 201, { ok: true }); }
      const session = accounts.login(data.email, data.password);
      res.setHeader('Set-Cookie', cookie('session', session, { httpOnly: true, secure: config.secureCookies }));
      return json(res, 200, { ok: true });
    }

    if (!user) return json(res, 401, { error: 'Please log in' });
    if (req.url === '/api/premium/order') return json(res, 201, premium.create(user, data.plan, data.payer));
    if (req.url === '/api/premium/redeem') return json(res, 200, await premium.redeem(user, data.orderId, data.signature, verifyDevnetPayment));
    if (req.url === '/api/store/order') return json(res, 201, store.create(user, data.productId, data.payer));
    if (req.url === '/api/store/redeem') {
      const result = await store.redeem(user, data.orderId, data.signature, verifyDevnetPayment);
      fireDelivery();
      return json(res, 200, result);
    }
    // Admin (RBAC). Role is assigned only via scripts/admin.mjs, never through any API.
    if (req.url.startsWith('/api/admin/')) {
      if (!admins.isAdmin(user)) return json(res, 403, { error: 'Admin access required' });
      if (req.url === '/api/admin/catalog/upsert') return json(res, 200, catalog.upsert(data.product || {}));
      if (req.url === '/api/admin/catalog/active') { catalog.setActive(data.id, !!data.active); return json(res, 200, { ok: true }); }
      if (req.url === '/api/admin/events/retry') { const retried = entitlements.retry(data.eventId); fireDelivery(); return json(res, 200, { retried }); }
      if (req.url === '/api/admin/grant') { const expires = entitlements.adminGrant(user, data.email, data.featureKey, data.days ?? null, data.reason); fireDelivery(); return json(res, 200, { expires }); }
      if (req.url === '/api/admin/revoke') { entitlements.adminRevoke(user, data.email, data.featureKey, data.reason); fireDelivery(); return json(res, 200, { ok: true }); }
      return json(res, 404, { error: 'Not found' });
    }
    if (req.url === '/api/logout') {
      accounts.logout(token);
      res.setHeader('Set-Cookie', cookie('session', '', { httpOnly: true, secure: config.secureCookies, maxAge: 0 }));
      return json(res, 200, { ok: true });
    }
    if (req.url !== '/api/chat') return json(res, 404, { error: 'Not found' });
    if (typeof data.message !== 'string' || !data.message.trim() || data.message.length > 2000)
      throw new Error('Message must contain 1–2000 characters');
    const cached = accounts.reserve(user, data.id, data.message);
    if (cached) return json(res, 200, { ...cached, balance: accounts.balance(user), charged: false });
    try {
      const reply = await generate(data.message);
      accounts.settle(user, data.id, reply);
      return json(res, 200, { reply, balance: accounts.balance(user), charged: true });
    } catch { accounts.refund(user, data.id); return json(res, 502, { error: 'AI unavailable; credit refunded' }); }
  } catch (error) { return json(res, 400, { error: error.message }); }
});

server.requestTimeout = 10000;
server.listen(config.port, config.bindHost, () =>
  log('info', { event: 'listening', url: 'http://' + config.bindHost + ':' + server.address().port, mode: config.mode }));

// Outbox worker: drain any pending/retryable deliveries, including ones left by a previous run.
const worker = setInterval(() => entitlements.deliver(deliverer).catch(e => log('error', { event: 'deliver_error', message: String(e && e.message || e) })), 15000);
worker.unref();
entitlements.deliver(deliverer).catch(() => {});

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { clearInterval(worker); server.close(() => { accounts.close(); process.exit(0); }); });
