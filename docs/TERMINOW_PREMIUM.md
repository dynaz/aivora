# TermiNow Premium Premium — Devnet sandbox

This is a redemption sandbox, **not** a production TermiNow integration. It neither reads nor changes real TermiNow accounts. User identity is currently the local TermiNow Store account. No token is created and no wallet transaction is signed by this server.

## Run
1. Start the local server and register/log in at `/`.
2. Configure `AIVR_DEVNET_MINT` and `AIVR_DEVNET_RECIPIENT_TOKEN_ACCOUNT` server-side. Use only a standard SPL Token Program mint with 6 decimals and an existing recipient token account for that mint. Token-2022 and fee-on-transfer tokens are unsupported.
3. Open `/premium` and create a quote with the payer's public address.
4. In a Devnet transaction tool, include one top-level SPL `transferChecked` instruction for the exact raw amount and a top-level Memo Program instruction containing the returned memo. Sign with the quoted payer wallet. Only use test assets. A wallet transaction-building button is not yet implemented.
5. Submit the finalized transaction signature. The server checks the fixed public Devnet RPC, Devnet genesis hash, successful finality, first signature, signer, memo, transfer details, decimals, recipient balance delta, and transaction block time against the quote window.

The 15-minute quote is valid for the payment block time; a finalized payment made within that window can be submitted later. Quotes use fixed **test** prices: 10 test TNAI for 30 days, 100 for 365 days. These are not approved retail prices or market quotations. Nonmatching transfers do not activate anything; there is no automated refund for mistakenly sent test tokens.

## API (authenticated TermiNow Store session required)
- `GET /api/premium/plans`
- `POST /api/premium/order` with `{ "plan": "terminow-30d", "payer": "PUBLIC_WALLET_ADDRESS" }`
- `POST /api/premium/redeem` with `{ "orderId": "UUID", "signature": "TRANSACTION_SIGNATURE" }`
- `GET /api/premium/status`

SQLite stores a globally unique payment signature and updates the sandbox entitlement in the same transaction. Resubmitting an already-paid order does not add days. Subsequent purchases extend from the later of current expiry and verification time. A duplicate payment cannot be assigned to a second order. Order memo binds payments to the quote; it is not proof of ownership of a real TermiNow account.

## Next integration boundary
Before changing real TermiNow Premium:
- Inspect the actual TermiNow backend and its entitlement model.
- Establish authenticated account linking using a short-lived, one-use server-issued link code or OAuth flow. Do not accept an arbitrary email/TermiNow user ID as proof of ownership.
- Deliver entitlement changes with an idempotent order ID through an authenticated server-to-server API and durable outbox/retries. Never expose an entitlement-signing secret in the mobile app.
- Handle existing subscriptions, expiry, reconciliation and support workflows.
- Review store-specific purchasing rules and applicable token/payment rules before any production launch. The sandbox UI must not be embedded into a store app as a checkout shortcut.
- Finalize real pricing and a manipulation-resistant quote source; a thin-pool last trade is not a safe pricing oracle.

## Validation
Automated tests use constructed RPC fixtures. No live Devnet payment, wallet connection, token mint, TermiNow account linking or real Premium activation has been tested. There are no mainnet endpoints or private keys in this implementation.
