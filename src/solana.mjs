const RPC='https://api.devnet.solana.com';
const GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MEMO='MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export function validatePayment(order,signature,tx) {
 if(!tx?.meta||tx.meta.err!==null||tx.transaction?.signatures?.[0]!==signature)throw new Error('Payment missing or failed');
 const time=tx.blockTime*1000;
 if(!Number.isSafeInteger(time)||time<order.created-5000||time>order.expires)throw new Error('Payment outside order window');
 const msg=tx.transaction.message;
 if(!msg.accountKeys.some(k=>k.pubkey===order.payer&&k.signer))throw new Error('Payer did not sign');
 if(!msg.instructions.some(i=>i.programId===MEMO&&i.parsed==='aivora:'+order.id))throw new Error('Order memo missing');
 const matches=msg.instructions.filter(i=>i.programId===TOKEN&&i.parsed?.type==='transferChecked').filter(i=>{
  const p=i.parsed.info;return p.mint===order.mint&&p.destination===order.destination&&p.authority===order.payer&&p.tokenAmount?.amount===order.amount&&p.tokenAmount?.decimals===6;
 });
 if(matches.length!==1)throw new Error('Exact SPL payment required');
 // Verify the recipient actually gained the quoted amount, not merely an instruction match.
 const index=msg.accountKeys.findIndex(k=>k.pubkey===order.destination);
 const before=tx.meta.preTokenBalances?.find(b=>b.accountIndex===index&&b.mint===order.mint);
 const after=tx.meta.postTokenBalances?.find(b=>b.accountIndex===index&&b.mint===order.mint);
 if(!before||!after||BigInt(after.uiTokenAmount.amount)-BigInt(before.uiTokenAmount.amount)!==BigInt(order.amount))throw new Error('Recipient balance mismatch');
}
export async function verifyDevnetPayment(order,signature,request=fetch) {
 if(typeof signature!=='string'||! /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))throw new Error('Invalid transaction signature');
 async function rpc(method,params=[]) {
  const response=await request(RPC,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  if(!response.ok)throw new Error('Devnet RPC unavailable');const data=await response.json();if(data.error)throw new Error('Devnet RPC rejected request');return data.result;
 }
 if(await rpc('getGenesisHash')!==GENESIS)throw new Error('Not Solana Devnet');
 const tx=await rpc('getTransaction',[signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]);
 validatePayment(order,signature,tx);
}
