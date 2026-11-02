# Aivora (AIVR)

AI services paid with usage credits. Initial budget: THB 10,000.

## Run the local prototype

Requires Node.js 22 or newer. No external packages required.

```sh
npm test
npm start
```

Open http://127.0.0.1:3000. This is a **local demo**: credits are in memory, reset on restart, and have no monetary value. Chat responses are simulated. No AI API requests, wallet connection, blockchain transactions or real payments are implemented.

## Project layout

- `src/ledger.mjs`: integer credit ledger with idempotent charging
- `src/server.mjs`: localhost-only demo UI and API
- `test/ledger.test.mjs`: credit accounting checks
- `docs/ROADMAP.md`: staged delivery plan
- `token/devnet.json`: proposed token configuration, not a deployed mint

## Security

Never commit wallet keypairs, seed phrases, private keys or API credentials. The demo server must not be exposed publicly. Production requires authentication, persistent transactional accounting, rate limiting and payment verification.

## Token status

Aivora / AIVR on Solana is proposed. Supply, allocations and utility are not finalized. No mainnet mint or liquidity pool has been created. Token ownership does not promise returns or revenue share.
