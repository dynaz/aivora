# Delivery roadmap

## 0 — Local prototype (this change)
- Local demo UI, simulated chat and in-memory integer credits.
- Idempotent charges and accounting tests.

## 1 — AI service MVP
- Select one provider and model; keep API keys on the server.
- Add user authentication and a persistent SQL ledger.
- Reserve estimated cost transactionally, settle actual usage and refund failed requests.
- Bind idempotency keys to user and request payload; save completed responses.
- Rate limits, usage caps, audit logs and concurrency tests.

## 2 — Solana Devnet
- Wallet sign-in with nonce, expiry and replay prevention.
- Create a test SPL mint; supply and allocations require an explicit final decision.
- Verify recipient, mint, raw amount, successful finality and network on the server.
- Enforce unique transaction signatures to prevent double crediting.
- Separate non-transferable service credits from AIVR tokens.

## 3 — Launch readiness
- Finalize utility, pricing, allocation and vesting disclosures.
- Review applicable offering and service requirements.
- Security review, backup/restore checks and production monitoring.
- Mainnet mint, removal of authorities, liquidity deposits and LP controls are separate explicit launch decisions. No automatic mainnet actions in CI.

## Budget
THB 10,000 is the total initial cap, not committed spending. Re-estimate hosting, AI API usage, chain fees and liquidity before launch; the earlier liquidity budget excludes ongoing AI operating costs.
