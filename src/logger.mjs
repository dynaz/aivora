// Structured JSON logging to stdout — one object per line. Never logs cookies, authorization headers,
// CSRF tokens, request bodies or env secrets: callers pass only the whitelisted fields below. systemd/
// journald captures stdout; nothing sensitive is written.

export function log(level, fields = {}) {
  const line = { ts: new Date().toISOString(), level, ...fields };
  try { process.stdout.write(JSON.stringify(line) + '\n'); } catch { /* stdout closed; drop */ }
}

// Per-request access log with method, path (no query), status, duration and client ip — no headers,
// no body, no identifiers that could carry secrets.
export function accessLog({ method, url, status, ms, ip }) {
  const path = typeof url === 'string' ? url.split('?')[0] : '';
  log('info', { event: 'request', method, path, status, ms, ip });
}
