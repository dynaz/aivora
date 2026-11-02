// NowAI admin console. All data comes from the RBAC-guarded /api/admin/* endpoints; this page only
// renders. A non-admin session sees a notice and no controls (the server enforces access regardless).
// Admin role is assigned out-of-band via scripts/admin.mjs, never here. Manual grants/revocations
// require a reason, which is recorded in the audit log.
export const adminPage = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NowAI Admin</title>
<style>
body{font:16px system-ui;background:#0b1024;color:#edf0ff;max-width:900px;margin:32px auto;padding:20px}
h1{color:#a995ff}h2{color:#9e8cff;font-size:17px;margin-top:26px;border-bottom:1px solid #2a2f52;padding-bottom:6px}
a{color:#8ef}.muted{color:#b7bfd6;font-size:13px}
input,select,button,textarea{box-sizing:border-box;padding:10px;margin:4px 0;border-radius:7px;border:1px solid #2a2f52;background:#141a36;color:#edf0ff}
button{background:#9e8cff;color:#0b1024;border:0;font-weight:600;cursor:pointer}
button.sm{padding:5px 10px;margin:0 0 0 6px}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:6px;border-bottom:1px solid #1c2140;vertical-align:top}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#141a36;padding:10px;border-radius:7px;font-size:12px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.gate{background:#241a2e;border:1px solid #5a2f52;border-radius:8px;padding:16px}
</style>
<h1>NowAI Admin</h1>
<p class="muted" id="who">Checking access…</p>
<div id="app" hidden>
  <p><a href="/store">Storefront</a> · <a href="/">Account</a></p>

  <h2>Catalog</h2>
  <div id="catalog" class="muted">…</div>
  <div class="row">
    <input id="p_id" placeholder="product-id">
    <select id="p_kind"><option value="subscription">subscription</option><option value="addon">addon</option><option value="consumable">consumable</option></select>
    <input id="p_name" placeholder="Name">
    <input id="p_feature" placeholder="feature-key">
    <input id="p_days" type="number" placeholder="days (subs)" style="width:110px">
    <input id="p_amount" placeholder="raw amount">
    <button id="p_save" type="button">Save product</button>
  </div>
  <p id="p_msg" class="muted"></p>

  <h2>Payment reconciliation</h2>
  <button id="rec_btn" type="button">Run reconciliation</button>
  <pre id="rec" hidden></pre>

  <h2>Entitlement delivery (outbox)</h2>
  <div class="row"><button id="ev_btn" type="button">Refresh</button><button id="ev_pending" type="button" class="sm">Pending only</button></div>
  <div id="events" class="muted">…</div>

  <h2>Manual grant / revoke</h2>
  <div class="row">
    <input id="g_email" placeholder="user email">
    <input id="g_feature" placeholder="feature-key">
    <input id="g_days" type="number" placeholder="days (blank=permanent)" style="width:170px">
    <input id="g_reason" placeholder="reason (required)">
    <button id="g_grant" type="button">Grant</button>
    <button id="g_revoke" type="button">Revoke</button>
  </div>
  <p id="g_msg" class="muted"></p>

  <h2>Orders</h2>
  <button id="ord_btn" type="button">Load orders</button>
  <pre id="orders" hidden></pre>

  <h2>Audit log</h2>
  <button id="aud_btn" type="button">Load audit log</button>
  <div id="audit" class="muted"></div>
</div>
<div id="gate" class="gate" hidden>You are signed in but not an administrator. Access is assigned out-of-band.</div>

<script>
function csrf(){return (document.cookie.match(/(?:^|; )csrf=([^;]+)/)||[])[1]||''}
async function api(method,path,data){
  const opt=method==='GET'?{}:{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf()},body:JSON.stringify(data)};
  const r=await fetch(path,opt); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||('HTTP '+r.status)); return d;
}
function when(ms){return ms?new Date(ms).toLocaleString():'—';}
async function loadCatalog(){
  const el=document.querySelector('#catalog');
  try{ const d=await api('GET','/api/admin/catalog');
    el.innerHTML='<table><tr><th>id</th><th>kind</th><th>feature</th><th>days</th><th>amount</th><th>active</th><th></th></tr>'+
      d.products.map(p=>'<tr><td>'+p.id+'</td><td>'+p.kind+'</td><td>'+p.feature_key+'</td><td>'+(p.days??'—')+'</td><td>'+p.amount+'</td><td>'+(p.active?'yes':'no')+'</td><td><button class="sm" type="button" onclick="toggleActive(\\''+p.id+'\\','+(p.active?0:1)+')">'+(p.active?'Disable':'Enable')+'</button></td></tr>').join('')+'</table>';
  }catch(e){ el.textContent=e.message; }
}
window.toggleActive=async(id,active)=>{ try{ await api('POST','/api/admin/catalog/active',{id,active:!!active}); loadCatalog(); }catch(e){ alert(e.message); } };
document.querySelector('#p_save').onclick=async()=>{
  const msg=document.querySelector('#p_msg');
  try{
    const days=document.querySelector('#p_days').value;
    await api('POST','/api/admin/catalog/upsert',{product:{id:p_id.value,kind:p_kind.value,name:p_name.value,feature_key:p_feature.value,days:days?Number(days):null,amount:p_amount.value}});
    msg.textContent='Saved.'; loadCatalog();
  }catch(e){ msg.textContent=e.message; }
};
document.querySelector('#rec_btn').onclick=async()=>{ const el=document.querySelector('#rec'); el.hidden=false; try{ el.textContent=JSON.stringify(await api('GET','/api/admin/reconcile'),null,2);}catch(e){ el.textContent=e.message; } };
async function loadEvents(status){
  const el=document.querySelector('#events');
  try{ const d=await api('GET','/api/admin/events'+(status?'?status='+status:''));
    if(!d.events.length){ el.textContent='No events.'; return; }
    el.innerHTML='<table><tr><th>event</th><th>feature</th><th>kind</th><th>status</th><th>att</th><th>error</th><th></th></tr>'+
      d.events.map(e=>'<tr><td>'+e.event_id+'</td><td>'+e.feature_key+'</td><td>'+e.kind+'</td><td>'+e.status+'</td><td>'+e.attempts+'</td><td>'+(e.last_error||'')+'</td><td>'+(e.status!=='delivered'?'<button class="sm" type="button" onclick="retry(\\''+e.event_id+'\\')">Retry</button>':'')+'</td></tr>').join('')+'</table>';
  }catch(e){ el.textContent=e.message; }
}
window.retry=async(id)=>{ try{ await api('POST','/api/admin/events/retry',{eventId:id}); loadEvents(); }catch(e){ alert(e.message); } };
document.querySelector('#ev_btn').onclick=()=>loadEvents();
document.querySelector('#ev_pending').onclick=()=>loadEvents('pending');
document.querySelector('#g_grant').onclick=async()=>{ const m=document.querySelector('#g_msg'); try{ const days=document.querySelector('#g_days').value; const d=await api('POST','/api/admin/grant',{email:g_email.value,featureKey:g_feature.value,days:days?Number(days):null,reason:g_reason.value}); m.textContent='Granted. Expires: '+when(d.expires); loadEvents(); }catch(e){ m.textContent=e.message; } };
document.querySelector('#g_revoke').onclick=async()=>{ const m=document.querySelector('#g_msg'); try{ await api('POST','/api/admin/revoke',{email:g_email.value,featureKey:g_feature.value,reason:g_reason.value}); m.textContent='Revoked.'; loadEvents(); }catch(e){ m.textContent=e.message; } };
document.querySelector('#ord_btn').onclick=async()=>{ const el=document.querySelector('#orders'); el.hidden=false; try{ el.textContent=JSON.stringify(await api('GET','/api/admin/orders'),null,2);}catch(e){ el.textContent=e.message; } };
document.querySelector('#aud_btn').onclick=async()=>{ const el=document.querySelector('#audit'); try{ const d=await api('GET','/api/admin/audit'); el.innerHTML='<table><tr><th>when</th><th>actor</th><th>action</th><th>subject</th><th>reason</th></tr>'+d.audit.map(a=>'<tr><td>'+when(a.ts)+'</td><td>'+a.actor+'</td><td>'+a.action+'</td><td>'+(a.subject||'')+'</td><td>'+(a.reason||'')+'</td></tr>').join('')+'</table>'; }catch(e){ el.textContent=e.message; } };
(async()=>{
  try{ const d=await api('GET','/api/admin/whoami');
    if(d.role){ document.querySelector('#who').textContent='Signed in as '+d.email+' ('+d.role+')'; document.querySelector('#app').hidden=false; loadCatalog(); loadEvents(); }
    else { document.querySelector('#who').textContent='Signed in as '+(d.email||'—'); document.querySelector('#gate').hidden=false; }
  }catch(e){ document.querySelector('#who').innerHTML='Please <a href="/">log in</a> first.'; }
})();
</script></html>`;
