// Central runtime configuration, parsed once from the environment and frozen. Nothing here is ever
// logged. Fail-safe: invalid or unsafe production configuration throws at startup rather than
// silently running an insecure service. The localhost demo keeps working with no configuration.

function parseOrigin(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('AIVORA_CANONICAL_ORIGIN must be a valid URL'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('AIVORA_CANONICAL_ORIGIN must be http(s)');
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash || url.username || url.password)
    throw new Error('AIVORA_CANONICAL_ORIGIN must be an origin only (scheme://host[:port])');
  return { origin: url.origin, host: url.host, secure: url.protocol === 'https:' };
}

function bool(v) { return v === '1' || v === 'true' || v === 'yes'; }

export function loadConfig(env = process.env) {
  const mode = env.AIVORA_ENV === 'production' ? 'production' : 'development';
  const canonical = parseOrigin(env.AIVORA_CANONICAL_ORIGIN);
  const trustProxy = bool(env.AIVORA_TRUST_PROXY);
  const bindHost = env.AIVORA_BIND_HOST || '127.0.0.1';
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be 0–65535');

  if (mode === 'production') {
    if (!canonical) throw new Error('AIVORA_CANONICAL_ORIGIN is required in production');
    if (!canonical.secure) throw new Error('Production canonical origin must be https');
    if (!trustProxy) throw new Error('AIVORA_TRUST_PROXY must be enabled behind the reverse proxy in production');
    if (bindHost !== '127.0.0.1' && bindHost !== '::1')
      throw new Error('Production must bind a loopback address; the reverse proxy is the public entry');
  }

  // Cookie Secure flag follows the canonical origin's scheme (https), never a forwarded header.
  const secureCookies = canonical ? canonical.secure : false;

  // Entitlement delivery (outbox worker). 'log' = sandbox (no real TermiNow call); 'http' = POST to the
  // TermiNow server-to-server endpoint. The admin key is server-only and never sent to clients.
  const deliveryMode = env.AIVORA_DELIVERY_MODE === 'http' ? 'http' : 'log';
  const delivery = Object.freeze({
    deliveryMode,
    deliveryUrl: env.TERMINOW_ENTITLEMENT_URL || '',
    deliveryKey: env.TERMINOW_ENTITLEMENT_KEY || '',
  });

  return Object.freeze({ mode, canonical, trustProxy, bindHost, port, secureCookies, delivery });
}
