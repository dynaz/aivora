# Aivora (AIVR)

Local prototype for AI services paid with demo usage credits. No real payments or blockchain token is deployed.

## Run
Requires Node.js 22.13+ (SQLite may emit an experimental warning on Node 22).

```sh
npm test
npm start
```

Open http://127.0.0.1:3000. Register with email and a 12–128 character password, then log in. Each account receives 100 **demo** credits. Each successful response costs one demo credit, regardless of token usage; this is not production pricing.

## AI configuration
Default mode is simulated and makes no external calls. To enable the OpenAI Responses API, copy `.env.example` to `.env`, set your key and a model available to your API account, then run:

```sh
node --env-file=.env src/server.mjs
```

Never commit credentials. Keys stay server-side. Live requests send the message to OpenAI, use a 30-second timeout, request at most 256 output tokens and set `store:false`. Review provider data policies before using sensitive content. Provider adapter tests use mocks; no live API call was tested.

## Accounts and accounting
Passwords are salted scrypt hashes. Session tokens are random, stored hashed, expire after 24 hours, and use HttpOnly/SameSite=Strict cookies. Authentication attempts are limited per process. SQLite transactions reserve one credit before a request. Explicit provider failure refunds once; completed answers are cached by user and request ID. Conflicting payloads are rejected. `/api/history` returns only the logged-in user's latest request IDs and states.

SQLite lives at `data/aivora.sqlite`, excluded from Git; override with `AIVORA_DB`. Previous shared demo ledger tables remain untouched but are no longer used. Back up with the server stopped. Requests contain message and response text; protect local data.

## Limits before production
Localhost-only development server; do not expose publicly. Email verification, password reset, HTTPS/Secure cookies, distributed rate limiting, registration abuse controls and production monitoring are still required. Demo signup credits are not monetary assets. One credit per response is a prototype rule, not an AI cost quotation.

A process crash during an upstream request leaves its credit reserved in `pending` state. Do not automatically retry or refund these: provider billing may already have happened. An operator reconciliation workflow is required before production. Provider failure refunds user credits but may still incur API costs. No real-money top-ups are implemented.

## Roadmap
See `docs/ROADMAP.md`. Proposed Solana configuration is in `token/devnet.json`; supply and allocation are not finalized. No mainnet transactions, liquidity deposits or removal of token authorities are automated.
