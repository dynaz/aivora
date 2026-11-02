import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
const hash = token => createHash('sha256').update(token).digest('hex');
export class Accounts {
 constructor(path) {
  this.db=new DatabaseSync(path);
  this.db.exec(`PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS users(email TEXT PRIMARY KEY,salt TEXT NOT NULL,password TEXT NOT NULL,credits INTEGER NOT NULL CHECK(credits>=0));
   CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS requests(email TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,reply TEXT,PRIMARY KEY(email,id));`);
 }
 register(email,password) {
  email=typeof email==='string'?email.trim().toLowerCase():'';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof password!=='string'||password.length<12||password.length>128) throw new Error('Valid email and 12–128 character password required');
  const salt=randomBytes(16).toString('hex');const digest=scryptSync(password,salt,32).toString('hex');
  try {this.db.prepare('INSERT INTO users VALUES (?,?,?,100)').run(email,salt,digest);} catch {throw new Error('Account cannot be created');}
  return email;
 }
 login(email,password) {
  if(typeof email!=='string'||typeof password!=='string'||password.length>128) throw new Error('Invalid credentials');
  const user=this.db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase());
  const digest=scryptSync(password,user?.salt||'invalid-user-salt',32);
  if(!user||!timingSafeEqual(digest,Buffer.from(user.password,'hex'))) throw new Error('Invalid credentials');
  const token=randomBytes(32).toString('hex');this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),user.email,Date.now()+86400000);return token;
 }
 user(token) {return this.db.prepare('SELECT email FROM sessions WHERE token=? AND expires>?').get(hash(token||''),Date.now())?.email;}
 logout(token) {this.db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token||''));}
 balance(email) {return this.db.prepare('SELECT credits FROM users WHERE email=?').get(email).credits;}
 history(email) {return this.db.prepare('SELECT id,state FROM requests WHERE email=? ORDER BY rowid DESC LIMIT 20').all(email);}
 reserve(email,id,message) {
  if(typeof id!=='string'||!id.trim()||id.length>128)throw new Error('Invalid request ID');
  this.db.exec('BEGIN IMMEDIATE');
  try {
   const old=this.db.prepare('SELECT * FROM requests WHERE email=? AND id=?').get(email,id);
   if(old){if(old.payload!==message)throw new Error('Request ID conflict');if(old.state!=='done')throw new Error('Request pending or failed; use a new ID');this.db.exec('COMMIT');return {reply:old.reply};}
   if(!this.db.prepare('UPDATE users SET credits=credits-1 WHERE email=? AND credits>=1').run(email).changes)throw new Error('Insufficient credits');
   this.db.prepare("INSERT INTO requests VALUES (?,?,?,'pending',NULL)").run(email,id,message);this.db.exec('COMMIT');return null;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 settle(email,id,reply) {this.db.prepare("UPDATE requests SET state='done',reply=? WHERE email=? AND id=? AND state='pending'").run(reply,email,id);}
 refund(email,id) {
  this.db.exec('BEGIN IMMEDIATE');try{const result=this.db.prepare("UPDATE requests SET state='failed' WHERE email=? AND id=? AND state='pending'").run(email,id);if(result.changes)this.db.prepare('UPDATE users SET credits=credits+1 WHERE email=?').run(email);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 close(){this.db.close();}
}
