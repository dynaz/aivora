import { randomUUID } from 'node:crypto';
export const plans = [
 {id:'terminow-30d',name:'TermiNow Premium — 30 days',days:30,rawAmount:'10000000'},
 {id:'terminow-365d',name:'TermiNow Premium — 365 days',days:365,rawAmount:'100000000'}
];
export class Premium {
 constructor(db, config) {
  this.db=db;this.config=config;
  db.exec(`CREATE TABLE IF NOT EXISTS premium_orders(id TEXT PRIMARY KEY,email TEXT NOT NULL,payer TEXT NOT NULL,plan TEXT NOT NULL,days INTEGER NOT NULL,amount TEXT NOT NULL,mint TEXT NOT NULL,destination TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,signature TEXT UNIQUE);
   CREATE TABLE IF NOT EXISTS sandbox_premium(email TEXT PRIMARY KEY,expires INTEGER NOT NULL);`);
 }
 create(email,planId,payer,now=Date.now()) {
  if(!this.config.mint||!this.config.destination)throw new Error('Devnet mint and recipient token account are not configured');
  if(typeof payer!=='string'||! /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payer))throw new Error('Valid payer wallet required');
  const plan=plans.find(p=>p.id===planId);if(!plan)throw new Error('Unknown plan');
  const order={id:randomUUID(),email,payer,plan:plan.id,days:plan.days,amount:plan.rawAmount,mint:this.config.mint,destination:this.config.destination,created:now,expires:now+15*60000,signature:null};
  this.db.prepare('INSERT INTO premium_orders VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(order));return this.public(order);
 }
 public(order){const {email,...safe}=order;return {...safe,network:'devnet',decimals:6,memo:'aivora:'+order.id,sandbox:true};}
 get(email,id){const order=this.db.prepare('SELECT * FROM premium_orders WHERE id=? AND email=?').get(id,email);if(!order)throw new Error('Order not found');return order;}
 status(email){return {sandbox:true,terminowLinked:false,expires:this.db.prepare('SELECT expires FROM sandbox_premium WHERE email=?').get(email)?.expires||null};}
 async redeem(email,id,signature,verify,now=Date.now()) {
  const order=this.get(email,id);
  if(order.signature){if(order.signature!==signature)throw new Error('Order already paid');return this.status(email);}
  await verify(order,signature);
  // Recheck under a write transaction after the asynchronous RPC call.
  this.db.exec('BEGIN IMMEDIATE');try{
   const latest=this.get(email,id);
   if(latest.signature){if(latest.signature!==signature)throw new Error('Order already paid');this.db.exec('COMMIT');return this.status(email);}
   const expiry=Math.max(now,this.status(email).expires||0)+order.days*86400000;
   this.db.prepare('UPDATE premium_orders SET signature=? WHERE id=?').run(signature,id);
   this.db.prepare('INSERT INTO sandbox_premium VALUES (?,?) ON CONFLICT(email) DO UPDATE SET expires=excluded.expires').run(email,expiry);
   this.db.exec('COMMIT');return this.status(email);
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
}
