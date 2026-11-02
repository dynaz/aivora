import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('API validates requests, charges once and persists across process restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aivora-api-'));
 let child;
 async function start(){
  child=spawn(process.execPath,['src/server.mjs'],{env:{...process.env,PORT:'0',AIVORA_DB:join(dir,'db.sqlite')},stdio:['ignore','pipe','pipe']});
  return await new Promise((resolve,reject)=>{
   let output='';const timer=setTimeout(()=>reject(new Error('Server startup timeout')),5000);
   child.once('error',e=>{clearTimeout(timer);reject(e);});
   child.once('exit',()=>{clearTimeout(timer);reject(new Error('Server exited before startup'));});
   child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
  });
 }
 async function stop(){if(child && child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done;}}
 try {
  let base=await start();
  const post=(data,headers={})=>fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await post({id:'bad',message:''})).status,400);
  assert.equal((await post({id:'bad',message:'hello'},{Origin:'https://other.example'})).status,403);
  assert.equal((await post({id:'once',message:'hello'})).status,200);
  assert.equal((await (await post({id:'once',message:'hello'})).json()).charged,false);
  assert.equal((await post({id:'once',message:'different'})).status,400);
  await stop();base=await start();
  assert.equal((await (await fetch(base+'/api/balance')).json()).balance,99);
  assert.equal((await (await post({id:'once',message:'hello'})).json()).charged,false);
  const history=await (await fetch(base+'/api/history')).json();
  assert.equal(history.transactions.length,1);
  assert.equal('payload' in history.transactions[0],false);
 } finally {await stop();rmSync(dir,{recursive:true,force:true});}
});
