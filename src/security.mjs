// Request-security helpers: Host/Origin allow-lists and CSRF double-submit tokens. These are pure and
// unit-tested. They never trust forwarded headers for security decisions — allow-lists are built from
// the server's own bind address and the configured canonical origin only.
import { randomBytes, timingSafeEqual } from 'node:crypto';

export function newCsrfToken() { return randomBytes(32).toString('hex'); }

// Constant-time compare of two hex tokens of equal length.
export function csrfValid(cookieToken, headerToken) {
  if (typeof cookieToken !== 'string' || typeof headerToken !== 'string') return false;
  if (cookieToken.length === 0 || cookieToken.length !== headerToken.length) return false;
  try { return timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken)); } catch { return false; }
}

export function allowedHosts(config, serverPort) {
  const hosts = new Set([
    config.bindHost + ':' + serverPort,
    '127.0.0.1:' + serverPort,
    'localhost:' + serverPort,
  ]);
  if (config.canonical) hosts.add(config.canonical.host);
  return hosts;
}

export function allowedOrigins(config, serverPort) {
  const origins = new Set([
    'http://' + config.bindHost + ':' + serverPort,
    'http://127.0.0.1:' + serverPort,
    'http://localhost:' + serverPort,
  ]);
  if (config.canonical) origins.add(config.canonical.origin);
  return origins;
}

export function hostAllowed(host, config, serverPort) {
  return typeof host === 'string' && allowedHosts(config, serverPort).has(host);
}

// Only reject when an Origin header is actually present (non-browser clients omit it); a present
// Origin must be in the allow-list.
export function originAllowed(origin, config, serverPort) {
  if (!origin) return true;
  return allowedOrigins(config, serverPort).has(origin);
}

export function readCookie(header, name) {
  const found = (header || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return found ? found.slice(name.length + 1) : undefined;
}

// Build a Set-Cookie value with safe defaults. HttpOnly is caller-controlled (CSRF cookie must be
// readable by the page script, session cookie must not be). Secure follows config, never a header.
export function cookie(name, value, { httpOnly = true, maxAge = 86400, secure = false } = {}) {
  let c = name + '=' + value + '; SameSite=Strict; Path=/; Max-Age=' + maxAge;
  if (httpOnly) c += '; HttpOnly';
  if (secure) c += '; Secure';
  return c;
}
