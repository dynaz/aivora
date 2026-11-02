# Aivora (AIVR)

AI services paid with usage credits. Initial budget: THB 10,000.

## Run the local prototype

Requires Node.js 22.13 or newer. No external packages required.

```sh
npm test
npm start
```

Open http://127.0.0.1:3000. This is a **local demo**: credits persist in a local SQLite database and have no monetary value. Chat responses are simulated. No AI API requests, wallet connection, blockchain transactions or real payments are implemented.

## Project layout

- `src/ledger.mjs`: transactional SQLite credit ledger with idempotent charging
- `src/server.mjs`: localhost-only demo UI and API
- `test/ledger.test.mjs`: credit accounting checks
- `docs/ROADMAP.md`: staged delivery plan
- `token/devnet.json`: proposed token configuration, not a deployed mint

## Security

Never commit wallet keypairs, seed phrases, private keys or API credentials. The demo server must not be exposed publicly. Production requires authentication, per-user transactional accounting, rate limiting and payment verification.

## Token status

Aivora / AIVR on Solana is proposed. Supply, allocations and utility are not finalized. No mainnet mint or liquidity pool has been created. Token ownership does not promise returns or revenue share.

## Local storage

The shared demo account starts with 100 credits only on first run. SQLite data is stored at `data/aivora.sqlite` (excluded from Git). Set `AIVORA_DB` to choose another path. `GET /api/history` returns the latest 20 charges without message content. Request IDs are bound to amount and message; retries do not charge twice, including after restart. The database contains message payloads for retry checks; protect or delete local demo data when finished. Back up only while the server is stopped. Node SQLite may emit an experimental warning on Node 22.
