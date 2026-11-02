# TermiNow Store ↔ TermiNow integration contract

This is the interface between the TermiNow Store backend and the TermiNow app/backend. It covers three
surfaces: **account linking**, the authenticated **"my entitlements"** API, and the server-to-server
**entitlement delivery** outbox. All amounts are raw SPL base units (decimals = 6); all timestamps are
epoch milliseconds; `expires: null` means a permanent (non-expiring) entitlement.

> **Network:** this phase runs on **Solana Devnet** only. Mainnet is disabled. Checkout is disabled
> entirely unless the Devnet mint and recipient token account are configured (fail-safe).

## Feature keys

Entitlements are addressed by a stable `feature_key`, not by product id (products are a catalog concern
and may change). Current keys:

| feature_key | meaning | seed products |
|-------------|---------|---------------|
| `terminow-premium` | TermiNow Premium (subscription, has an expiry) | `terminow-premium-30d`, `terminow-premium-365d` |
| `addon-network-scan` | Network Scan add-on (permanent) | `addon-network-scan` |

The catalog is admin-managed, so TermiNow should treat `feature_key` as the contract and tolerate new
keys appearing. A subscription key carries an `expires`; a permanent key has `expires: null`.

## 1. Account linking

A store account is bound to a TermiNow install through a **short-lived, single-use code**. There is no
way to link by submitting an arbitrary email or id — only a redeemed code creates a link.

1. The signed-in user mints a code in the storefront (`POST /api/link/code`, session-authenticated).
   The code is shown once; only its sha256 hash is stored server-side. TTL: 10 minutes.
2. The user enters the code in TermiNow. The TermiNow backend redeems it:

```
POST /api/link/redeem            (public endpoint; the code is the bearer of authority; rate-limited per IP)
Content-Type: application/json
X-CSRF-Token: <csrf cookie value>      # double-submit; GET /api/csrf issues the cookie + token

{ "code": "<code from the user>", "terminowRef": "<opaque TermiNow account/device id>" }

200 OK
{ "email": "buyer@example.com",
  "entitlements": [ { "feature_key": "terminow-premium", "expires": 1767225600000, "source": "purchase" } ] }
```

- **Single use / replay:** a second redeem of the same code returns `400 { "error": "Link code already used" }`.
  An expired code returns `400 { "error": "Link code expired" }`.
- `email` is the linked store identity and is the key used by the delivery outbox (below). Store it
  against `terminowRef`.
- `entitlements` is a snapshot of current state so the app can reflect it immediately; future changes
  arrive via delivery.

> **Note:** the public `POST`s require the CSRF double-submit header because the browser storefront shares
> the same server. A server-to-server integration simply fetches `GET /api/csrf` first and echoes the
> cookie + token, as shown.

## 2. Authenticated "my entitlements" API

For a browser/session context (the storefront, or a first-party client holding the session cookie):

```
GET /api/entitlements            (session cookie required)
200 OK
{ "entitlements": [
    { "feature_key": "terminow-premium",   "expires": 1767225600000, "source": "purchase" },
    { "feature_key": "addon-network-scan",  "expires": null,          "source": "purchase" }
] }
```

`source` is `purchase` (Devnet checkout) or `grant` (admin manual grant). An entitlement is active when
`expires` is `null` or in the future.

## 3. Entitlement delivery (server → server, outbox)

Every grant and revoke is written to a durable outbox with an **idempotent `eventId`** and delivered by a
background worker with exponential backoff. Delivery **resumes after a process restart** and retries up to
10 attempts; an admin can force an immediate retry from the admin console.

Configure the backend with `AIVORA_DELIVERY_MODE=http`, `TERMINOW_ENTITLEMENT_URL`, and
`TERMINOW_ENTITLEMENT_KEY`. TermiNow must expose an endpoint that accepts:

```
POST <TERMINOW_ENTITLEMENT_URL>
Authorization: Bearer <TERMINOW_ENTITLEMENT_KEY>     # server-only secret — see security note
Idempotency-Key: <eventId>
Content-Type: application/json

{ "eventId":   "order:<orderId>"  |  "grant:<uuid>"  |  "revoke:<uuid>",
  "email":     "buyer@example.com",
  "featureKey":"terminow-premium",
  "kind":      "grant" | "revoke",
  "expires":   1767225600000,          // present on grant; null = permanent
  "source":    "purchase" | "grant" }
```

**Delivery semantics TermiNow must honor:**
- **Idempotency:** the same `eventId` / `Idempotency-Key` may be delivered more than once (retries,
  restarts). Process each `eventId` at most once; acknowledge duplicates with `2xx`.
- **Success = `2xx`.** Any non-2xx or a network error causes TermiNow Store to retry with backoff; return `2xx`
  only once the grant/revoke is durably applied.
- **Ordering is not guaranteed.** Reconcile by `email` + `featureKey`; a `revoke` supersedes an earlier
  `grant` for the same pair. When in doubt, the authenticated entitlements API is the source of truth.

### Security
- `TERMINOW_ENTITLEMENT_KEY` and any Solana signing key live **only on the servers**. They are **never**
  shipped in the TermiNow mobile app. The app authenticates users by session or by the linked
  `terminowRef`, and reads entitlements via the API / receives them via the backend — it never holds an
  admin or signing secret.
- Admin roles in TermiNow Store are assigned out-of-band only (a CLI on the server); there is no API or signup
  path to become an admin.

## Verification status (what has actually been exercised)

| Surface | Status |
|---------|--------|
| Account linking (create / redeem / replay / expiry) | **Automated tests** (unit + HTTP). Not yet exercised against a real TermiNow backend. |
| "My entitlements" API | **Automated tests** (HTTP, under auth + CSRF). |
| Order lifecycle, entitlement grant/extend, outbox idempotency & retry-after-restart | **Automated tests.** |
| Solana payment verification (network / mint / recipient / amount / memo / failed tx) | **Automated tests with a mocked RPC.** Pending: a real signed Devnet transaction against live RPC. |
| Delivery in `http` mode to a real TermiNow endpoint | **Not yet integrated** — needs the TermiNow endpoint + a shared key. |
| Mainnet / production grants | **Disabled.** Out of scope for this phase. |
