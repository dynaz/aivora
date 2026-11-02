import test from 'node:test';import assert from 'node:assert/strict';
import { Accounts } from '../src/accounts.mjs';import { generate } from '../src/provider.mjs';
test('accounts isolate credits, refund once and scope retries by user',()=>{
 const a=new Accounts(':memory:');try{for(const email of ['a@x.com','b@x.com'])a.register(email,'long-password-123');
 assert.throws(()=>a.login('a@x.com','incorrect'));const session=a.login('a@x.com','long-password-123');assert.equal(a.user(session),'a@x.com');a.logout(session);assert.equal(a.user(session),undefined);
 a.reserve('a@x.com','one','hi');assert.equal(a.balance('a@x.com'),99);assert.equal(a.balance('b@x.com'),100);
 a.refund('a@x.com','one');a.refund('a@x.com','one');assert.equal(a.balance('a@x.com'),100);
 a.reserve('b@x.com','one','hi');a.settle('b@x.com','one','saved');assert.equal(a.reserve('b@x.com','one','hi').reply,'saved');assert.equal(a.balance('b@x.com'),99);
 }finally{a.close();}
});
test('provider parses completed text and hides upstream errors',async()=>{
 const previous={mode:process.env.AIVORA_AI_MODE,key:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL};
 try{process.env.AIVORA_AI_MODE='openai';process.env.OPENAI_API_KEY='test';process.env.OPENAI_MODEL='test-model';
 assert.equal(await generate('hello',async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Hello'}]}]})})),'Hello');
 await assert.rejects(generate('hello',async()=>({ok:false})),/unavailable/);
 }finally{for(const [key,value]of Object.entries({AIVORA_AI_MODE:previous.mode,OPENAI_API_KEY:previous.key,OPENAI_MODEL:previous.model})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
