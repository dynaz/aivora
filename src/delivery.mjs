// Entitlement-delivery adapter for the outbox worker. Two modes:
//   - 'log' (sandbox default): records the delivery and succeeds. No real TermiNow call is made; this
//     is the documented integration boundary. Use for the Devnet sandbox.
//   - 'http': POSTs to the configured TermiNow server-to-server endpoint with a bearer admin key and an
//     Idempotency-Key header. The key is read from server env only and never leaves the server.
// Unconfigured 'http' throws, so events stay queued for retry rather than being silently dropped.
import { log } from './logger.mjs';

export function makeDeliverer(config, request = fetch) {
  if (config.deliveryMode === 'http') {
    return async (event) => {
      if (!config.deliveryUrl || !config.deliveryKey) throw new Error('TermiNow delivery endpoint not configured');
      const res = await request(config.deliveryUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.deliveryKey, 'Idempotency-Key': event.eventId },
        body: JSON.stringify({ eventId: event.eventId, email: event.email, featureKey: event.featureKey, kind: event.kind, expires: event.expires ?? null }),
      });
      if (!res.ok) throw new Error('Delivery rejected: ' + res.status);
    };
  }
  return async (event) => { log('info', { event: 'delivery_sandbox', eventId: event.eventId, featureKey: event.featureKey, kind: event.kind }); };
}
