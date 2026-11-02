import http from 'node:http';
import { Ledger } from './ledger.mjs';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const dbPath = resolve(process.env.AIVORA_DB || 'data/aivora.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const ledger = new Ledger(100, dbPath);
const port = Number(process.env.PORT || 3000);
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aivora Demo</title><style>body{background:#0b1024;color:#edf0ff;font:17px system-ui;max-width:700px;margin:60px auto;padding:24px}h1{color:#9e8cff}textarea{box-sizing:border-box;width:100%;min-height:100px;padding:16px}button{background:#9e8cff;border:0;padding:14px 24px;border-radius:10px;margin-top:12px;cursor:pointer}pre{white-space:pre-wrap}small{color:#b7bfd6}</style><h1>Aivora <small>AIVR</small></h1><p>Local AI credit prototype</p><p>Credits: <strong id="balance">100</strong></p><small>Demo only · 1 credit per simulated reply · No real AI or payments · Credits saved locally</small><form><p><textarea required maxlength="2000" placeholder="Write a message"></textarea></p><button>Send demo message</button></form><pre id="reply"></pre><script>const form=document.querySelector('form');const button=document.querySelector('button');async function refresh(){const r=await fetch('/api/balance');const d=await r.json();document.querySelector('#balance').textContent=d.balance}refresh();form.onsubmit=async(e)=>{e.preventDefault();button.disabled=true;try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),message:document.querySelector('textarea').value})});const d=await r.json();document.querySelector('#reply').textContent=d.reply||d.error;await refresh()}catch{document.querySelector('#reply').textContent='Connection failed. Refresh to check balance.'}finally{button.disabled=false}};</script></html>`;
function json(res, status, data) { res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method === 'GET' && req.url === '/') { res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); return res.end(page); }
  if (req.method === 'GET' && req.url === '/api/balance') return json(res,200,{balance:ledger.balance});
  if (req.method === 'GET' && req.url === '/api/history') return json(res,200,{transactions:ledger.history()});
  if (req.method === 'POST' && req.url === '/api/chat') {
    // Reject browser cross-origin requests; this remains a localhost demo, not production auth.
    if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:'+port) return json(res,403,{error:'Origin rejected'});
    if (req.headers['content-type'] !== 'application/json') return json(res,415,{error:'JSON required'});
    try {
      let body = ''; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 8192) { json(res,413,{error:'Request too large'}); return; } body += chunk; }
      const data = JSON.parse(body);
      if (!data || typeof data.message !== 'string' || !data.message.trim() || data.message.length > 2000) throw new Error('Message must contain 1–2000 characters');
      const result = ledger.charge(data.id,1,data.message);
      return json(res,200,{...result,reply:'Simulated AI reply. Provider integration is planned.'});
    } catch (error) { return json(res,400,{error:error.message}); }
  }
  return json(res,404,{error:'Not found'});
});
server.requestTimeout = 10000;
server.listen(port,'127.0.0.1',()=>console.log('Aivora demo: http://127.0.0.1:'+server.address().port));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{ledger.close();process.exit(0);}));
