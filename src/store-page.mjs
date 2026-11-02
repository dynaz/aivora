// TermiNow Store storefront (Devnet sandbox): browse the catalog, create a quote for a product, submit a
// finalized Devnet payment signature, and view entitlements. Test tokens only — this never activates
// anything in the real TermiNow app and never asks for a seed phrase. CSRF token is read from the
// readable csrf cookie and echoed on every state-changing request.
export const storePage = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TermiNow Store</title>
<style>
body{font:17px system-ui;background:#0b1024;color:#edf0ff;max-width:760px;margin:40px auto;padding:24px}
h1{color:#a995ff;margin-bottom:4px}h2{color:#9e8cff;font-size:18px;margin-top:28px}
a{color:#8ef}.muted{color:#b7bfd6;font-size:14px}
.card{border:1px solid #2a2f52;border-radius:12px;padding:14px;margin:10px 0}
.card h3{margin:0 0 4px;font-size:16px}
input,select,button{box-sizing:border-box;width:100%;padding:13px;margin:6px 0;border-radius:8px;border:1px solid #2a2f52;background:#141a36;color:#edf0ff}
button{background:#9e8cff;color:#0b1024;border:0;font-weight:600;cursor:pointer}
button.buy{width:auto;padding:8px 16px;margin:0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#141a36;padding:12px;border-radius:8px}
.badge{display:inline-block;background:#1c2a3e;color:#8ef;border-radius:6px;padding:2px 8px;font-size:12px}
</style>
<h1>TermiNow Store</h1>
<p class="muted">TermiNow Premium &amp; feature add-ons · paid in TermiNow AI (TNAI) Devnet test token · test prices only, no monetary value</p>
<p><a href="/">Account (log in / register)</a></p>
<p id="status" class="muted"></p>

<h2>Your entitlements</h2>
<div id="entitlements" class="muted">Log in to view.</div>

<h2>Catalog</h2>
<div id="catalog" class="muted">Loading…</div>

<h2>Checkout (Devnet)</h2>
<p class="muted">Pick a product above, enter your Devnet wallet, create a quote, then pay with an exact SPL transferChecked plus the order memo in one transaction and submit the finalized signature. Mainnet is disabled.</p>
<input id="payer" placeholder="Devnet payer wallet address" autocomplete="off">
<button id="create" type="button">Create quote</button>
<pre id="order" hidden></pre>
<input id="signature" placeholder="Finalized transaction signature" autocomplete="off">
<button id="redeem" type="button">Verify payment</button>
<pre id="result" hidden></pre>

<h2>Link the TermiNow app</h2>
<p class="muted">Generate a one-time code, then enter it in TermiNow to link this account. Each code is valid for 10 minutes and works once.</p>
<button id="link" type="button">Generate link code</button>
<pre id="linkcode" hidden></pre>

<script>
function csrf(){return (document.cookie.match(/(?:^|; )csrf=([^;]+)/)||[])[1]||''}
let selected=null, order=null;
async function api(method,path,data){
  const opt=method==='GET'?{}:{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf()},body:JSON.stringify(data)};
  const r=await fetch(path,opt); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||('HTTP '+r.status)); return d;
}
function money(raw){ return (Number(raw)/1e6).toLocaleString()+' test TNAI'; }
function when(ms){ return ms?new Date(ms).toLocaleString():'—'; }
async function loadCatalog(){
  const el=document.querySelector('#catalog');
  try{
    const d=await api('GET','/api/catalog');
    el.innerHTML='';
    for(const p of d.products){
      const div=document.createElement('div'); div.className='card';
      const term=p.kind==='subscription'?(p.days+' days'):'permanent';
      div.innerHTML='<h3>'+p.name+' <span class="badge">'+term+'</span></h3><div class="muted">'+(p.description||'')+' · '+money(p.amount)+'</div>';
      const b=document.createElement('button'); b.className='buy'; b.textContent='Select'; b.type='button';
      b.onclick=()=>{selected=p.id; document.querySelector('#status').textContent='Selected: '+p.name;};
      div.appendChild(b); el.appendChild(div);
    }
  }catch(e){ el.textContent=e.message; }
}
async function loadEntitlements(){
  const el=document.querySelector('#entitlements');
  try{
    const d=await api('GET','/api/entitlements');
    if(!d.entitlements.length){ el.textContent='None yet.'; return; }
    el.innerHTML=d.entitlements.map(e=>'<div class="card"><strong>'+e.feature_key+'</strong><div class="muted">'+(e.expires===null?'Permanent':'Expires '+when(e.expires))+' · via '+e.source+'</div></div>').join('');
  }catch(e){ el.textContent='Log in to view.'; }
}
document.querySelector('#create').onclick=async()=>{
  const out=document.querySelector('#order'); out.hidden=false;
  try{
    if(!selected) throw new Error('Select a product first');
    order=await api('POST','/api/store/order',{productId:selected,payer:document.querySelector('#payer').value});
    out.textContent=JSON.stringify(order,null,2);
    try{ localStorage.setItem('aivoraStoreOrder',order.id); }catch{}
  }catch(e){ out.textContent=e.message; }
};
document.querySelector('#redeem').onclick=async()=>{
  const out=document.querySelector('#result'); out.hidden=false;
  try{
    let id=order&&order.id; try{ id=id||localStorage.getItem('aivoraStoreOrder'); }catch{}
    const d=await api('POST','/api/store/redeem',{orderId:id,signature:document.querySelector('#signature').value});
    out.textContent=JSON.stringify(d,null,2); loadEntitlements();
  }catch(e){ out.textContent=e.message; }
};
document.querySelector('#link').onclick=async()=>{
  const out=document.querySelector('#linkcode'); out.hidden=false;
  try{
    const d=await api('POST','/api/link/code',{});
    out.textContent='Code: '+d.code+'\\nExpires: '+when(d.expires)+'\\nEnter this in TermiNow within 10 minutes.';
  }catch(e){ out.textContent=e.message; }
};
loadCatalog(); loadEntitlements();
</script></html>`;
