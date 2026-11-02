import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Premium } from '../src/premium.mjs';
import { validatePayment, verifyDevnetPayment } from '../src/solana.mjs';
const payer='11111111111111111111111111111111';
const sig='2'.repeat(88);
function fixture(){const db=new DatabaseSync(':memory:');const premium=new Premium(db,{mint:'mint',destination:'recipient'});const safe=premium.create('a@example.com','terminow-30d',payer,1000000);const order=premium.get('a@example.com',safe.id);return {db,premium,order};}
function transaction(order){return {blockTime:1001,meta:{err:null,preTokenBalances:[{accountIndex:1,mint:order.mint,uiTokenAmount:{amount:'0'}}],postTokenBalances:[{accountIndex:1,mint:order.mint,uiTokenAmount:{amount:order.amount}}]},transaction:{signatures:[sig],message:{accountKeys:[{pubkey:payer,signer:true},{pubkey:'recipient',signer:false}],instructions:[{programId:'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',parsed:'aivora:'+order.id},{programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',parsed:{type:'transferChecked',info:{mint:order.mint,destination:order.destination,authority:payer,tokenAmount:{amount:order.amount,decimals:6}}}}]}}};}
test('verified payment grants sandbox days once, isolates users and prevents replay',async()=>{
 const {db,premium,order}=fixture();try{
 const verify=async(o,s)=>validatePayment(o,s,transaction(o));
 const result=await premium.redeem(order.email,order.id,sig,verify,1002000);
 assert.equal(result.expires,1002000+30*86400000);assert.equal(result.terminowLinked,false);
 assert.deepEqual(await premium.redeem(order.email,order.id,sig,verify,2000000),result);
 assert.throws(()=>premium.get('other@example.com',order.id),/not found/);
 const other=premium.create('b@example.com','terminow-30d',payer,1000000);
 await assert.rejects(premium.redeem('b@example.com',other.id,sig,verify),/UNIQUE/);
 assert.equal(premium.status('b@example.com').expires,null);
 const next=premium.create(order.email,'terminow-30d',payer,1000000);
 await premium.redeem(order.email,next.id,'3'.repeat(88),async()=>{},1003000);
 assert.equal(premium.status(order.email).expires,result.expires+30*86400000);
 }finally{db.close();}
});
test('rejects wrong mint, recipient, amount, decimals, memo, payer, status and time',()=>{
 const {db,order}=fixture();try{
 validatePayment(order,sig,transaction(order));
 const mutations=[
 t=>{t.meta.err={failed:true}},t=>{t.blockTime=1},t=>{t.blockTime=999999},
 t=>{t.transaction.signatures[0]='other'},t=>{t.transaction.message.accountKeys[0].signer=false},
 t=>{t.transaction.message.instructions[0].parsed='wrong'},
 ...['mint','destination','authority'].map(field=>t=>{t.transaction.message.instructions[1].parsed.info[field]='wrong'}),
 t=>{t.transaction.message.instructions[1].parsed.info.tokenAmount.amount='1'},
 t=>{t.transaction.message.instructions[1].parsed.info.tokenAmount.decimals=9},
 t=>{t.meta.postTokenBalances[0].uiTokenAmount.amount='0'},
 t=>{t.transaction.message.instructions[1].programId='wrong'}
 ];
 for(const mutate of mutations){const tx=transaction(order);mutate(tx);assert.throws(()=>validatePayment(order,sig,tx));}
 assert.throws(()=>validatePayment(order,sig,null));
 }finally{db.close();}
});
test('verifier requires Devnet and finalized RPC lookup',async()=>{
 const {db,order}=fixture();try{
 await assert.rejects(verifyDevnetPayment(order,sig,async()=>({ok:true,json:async()=>({result:'mainnet'})})),/Devnet/);
 const calls=[];
 await verifyDevnetPayment(order,sig,async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);return {ok:true,json:async()=>({result:body.method==='getGenesisHash'?'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG':transaction(order)})};});
 assert.equal(calls[1].params[1].commitment,'finalized');
 }finally{db.close();}
});
test('missing configuration and failed verification never grant entitlement',async()=>{
 const {db,premium,order}=fixture();try{
 assert.throws(()=>new Premium(db,{}).create(order.email,'terminow-30d',payer),/configured/);
 await assert.rejects(premium.redeem(order.email,order.id,sig,async()=>{throw Error('RPC unavailable')}));
 assert.equal(premium.status(order.email).expires,null);
 }finally{db.close();}
});
