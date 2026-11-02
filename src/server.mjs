import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { Accounts } from './accounts.mjs';
import { generate } from './provider.mjs';
import { Premium, plans } from './premium.mjs';
import { verifyDevnetPayment } from './solana.mjs';
import { premiumPage } from './premium-page.mjs';
import { page } from './page.mjs';
const path=resolve(process.env.AIVORA_DB||'data/aivora.sqlite');mkdirSync(dirname(path),{recursive:true});
const accounts=new Accounts(path);const port=Number(process.env.PORT||3000);
const premium=new Premium(accounts.db,{mint:process.env.AIVR_DEVNET_MINT,destination:process.env.AIVR_DEVNET_RECIPIENT_TOKEN_ACCOUNT});
const attempts=new Map();
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
 const expected='127.0.0.1:'+server.address().port;
 if(req.headers.host!==expected)return json(res,403,{error:'Host rejected'});
 if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(page);}
 if(req.method==='GET'&&req.url==='/premium'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(premiumPage);}
 const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8)||'';
 const user=accounts.user(token);
 if(req.method==='GET'){
  if(!user)return json(res,401,{error:'Please log in'});
  if(req.url==='/api/premium/plans')return json(res,200,{sandbox:true,plans});
  if(req.url==='/api/premium/status')return json(res,200,premium.status(user));
  if(req.url==='/api/balance')return json(res,200,{email:user,balance:accounts.balance(user)});
  if(req.url==='/api/history')return json(res,200,{transactions:accounts.history(user)});
 }
 if(req.method!=='POST')return json(res,404,{error:'Not found'});
 if(req.headers.origin&&req.headers.origin!=='http://'+expected)return json(res,403,{error:'Origin rejected'});
 if(req.headers['content-type']!=='application/json')return json(res,415,{error:'JSON required'});
 try{
  let body='';let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)return json(res,413,{error:'Request too large'});body+=chunk;}
  const data=JSON.parse(body);if(!data||typeof data!=='object')throw new Error('Invalid request');
  if(['/api/register','/api/login'].includes(req.url)){
   const key=req.socket.remoteAddress;const now=Date.now();let bucket=attempts.get(key);if(!bucket||now>bucket.until){bucket={count:0,until:now+60000};attempts.set(key,bucket);}if(++bucket.count>10)return json(res,429,{error:'Try again in one minute'});
   if(req.url==='/api/register'){accounts.register(data.email,data.password);return json(res,201,{ok:true});}
   const session=accounts.login(data.email,data.password);res.setHeader('Set-Cookie','session='+session+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400');return json(res,200,{ok:true});
  }
  if(!user)return json(res,401,{error:'Please log in'});
  if(req.url==='/api/premium/order')return json(res,201,premium.create(user,data.plan,data.payer));
  if(req.url==='/api/premium/redeem')return json(res,200,await premium.redeem(user,data.orderId,data.signature,verifyDevnetPayment));
  if(req.url==='/api/logout'){accounts.logout(token);res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
  if(req.url!=='/api/chat')return json(res,404,{error:'Not found'});
  if(typeof data.message!=='string'||!data.message.trim()||data.message.length>2000)throw new Error('Message must contain 1–2000 characters');
  const cached=accounts.reserve(user,data.id,data.message);
  if(cached)return json(res,200,{...cached,balance:accounts.balance(user),charged:false});
  try{const reply=await generate(data.message);accounts.settle(user,data.id,reply);return json(res,200,{reply,balance:accounts.balance(user),charged:true});}
  catch{accounts.refund(user,data.id);return json(res,502,{error:'AI unavailable; credit refunded'});}
 }catch(error){return json(res,400,{error:error.message});}
});
server.requestTimeout=10000;server.listen(port,'127.0.0.1',()=>console.log('Aivora demo: http://127.0.0.1:'+server.address().port));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{accounts.close();process.exit(0);}));
