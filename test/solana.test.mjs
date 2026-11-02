import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePayment, verifyDevnetPayment } from '../src/solana.mjs';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

const SIG = '5'.repeat(88); // base58-shaped placeholder signature

// A canonical order and a matching finalized transaction. Helpers below mutate copies to model each
// failure the matrix calls for (wrong mint / recipient / amount / network / failed tx).
function order(over = {}) {
  return { id: 'ord-1', payer: 'PAYER', mint: 'MINT', destination: 'DEST', amount: '10000000', created: 1000, expires: 2000, ...over };
}
function tx(over = {}) {
  const o = order();
  return {
    blockTime: 1, // ms = 1000, inside [created-5000, expires]
    meta: {
      err: null,
      preTokenBalances: [{ accountIndex: 1, mint: o.mint, uiTokenAmount: { amount: '0' } }],
      postTokenBalances: [{ accountIndex: 1, mint: o.mint, uiTokenAmount: { amount: o.amount } }],
    },
    transaction: {
      signatures: [SIG],
      message: {
        accountKeys: [{ pubkey: o.payer, signer: true }, { pubkey: o.destination, signer: false }],
        instructions: [
          { programId: MEMO, parsed: 'aivora:' + o.id },
          { programId: TOKEN, parsed: { type: 'transferChecked', info: { mint: o.mint, destination: o.destination, authority: o.payer, tokenAmount: { amount: o.amount, decimals: 6 } } } },
        ],
      },
    },
    ...over,
  };
}

test('a correct Devnet payment validates', () => {
  assert.doesNotThrow(() => validatePayment(order(), SIG, tx()));
});

test('a failed transaction (meta.err) is rejected', () => {
  const t = tx(); t.meta.err = { InstructionError: [0, 'Custom'] };
  assert.throws(() => validatePayment(order(), SIG, t), /missing or failed/);
});

test('a missing/mismatched signature is rejected', () => {
  const t = tx(); t.transaction.signatures = ['different'];
  assert.throws(() => validatePayment(order(), SIG, t), /missing or failed/);
});

test('wrong mint is rejected', () => {
  const t = tx(); t.transaction.message.instructions[1].parsed.info.mint = 'OTHER_MINT';
  assert.throws(() => validatePayment(order(), SIG, t), /Exact SPL payment/);
});

test('wrong recipient (destination) is rejected', () => {
  const t = tx(); t.transaction.message.instructions[1].parsed.info.destination = 'ATTACKER';
  assert.throws(() => validatePayment(order(), SIG, t), /Exact SPL payment/);
});

test('wrong amount is rejected (too little and too much)', () => {
  const low = tx(); low.transaction.message.instructions[1].parsed.info.tokenAmount.amount = '9999999';
  assert.throws(() => validatePayment(order(), SIG, low), /Exact SPL payment/);
  const high = tx(); high.transaction.message.instructions[1].parsed.info.tokenAmount.amount = '20000000';
  assert.throws(() => validatePayment(order(), SIG, high), /Exact SPL payment/);
});

test('an instruction match without a real recipient balance gain is rejected', () => {
  const t = tx(); t.meta.postTokenBalances[0].uiTokenAmount.amount = '0'; // no actual delta
  assert.throws(() => validatePayment(order(), SIG, t), /balance mismatch/);
});

test('a wrong memo (order id binding) is rejected', () => {
  const t = tx(); t.transaction.message.instructions[0].parsed = 'aivora:other-order';
  assert.throws(() => validatePayment(order(), SIG, t), /memo/);
});

test('a payment outside the order time window is rejected', () => {
  const t = tx({ blockTime: 10 }); // 10_000 ms > expires (2000)
  assert.throws(() => validatePayment(order(), SIG, t), /window/);
});

test('verifyDevnetPayment rejects a non-Devnet network before looking at the tx', async () => {
  const request = async (url, opt) => {
    const body = JSON.parse(opt.body);
    if (body.method === 'getGenesisHash') return jsonResp({ result: 'MainnetGenesisHashXXXXXXXXXXXXXXXXXXXXXXXXXXX' });
    throw new Error('should not fetch the transaction on the wrong network');
  };
  await assert.rejects(() => verifyDevnetPayment(order(), SIG, request), /Devnet/);
});

test('verifyDevnetPayment accepts a correct Devnet transaction end to end', async () => {
  const request = async (url, opt) => {
    const body = JSON.parse(opt.body);
    if (body.method === 'getGenesisHash') return jsonResp({ result: GENESIS });
    if (body.method === 'getTransaction') return jsonResp({ result: tx() });
    throw new Error('unexpected RPC ' + body.method);
  };
  await assert.doesNotReject(() => verifyDevnetPayment(order(), SIG, request));
});

test('verifyDevnetPayment rejects a malformed signature without any RPC call', async () => {
  let called = false;
  const request = async () => { called = true; return jsonResp({ result: GENESIS }); };
  await assert.rejects(() => verifyDevnetPayment(order(), 'bad sig!', request), /Invalid transaction signature/);
  assert.equal(called, false);
});

function jsonResp(obj) { return { ok: true, json: async () => obj }; }
