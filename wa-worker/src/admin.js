export const ADMIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chandni WhatsApp inbox</title><style>
  :root{color-scheme:dark;font-family:system-ui,sans-serif}body{max-width:900px;margin:0 auto;padding:24px;background:#10151b;color:#ecf2f5}h1{font-size:1.5rem}p{color:#b7c3cb}input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #42515b}input{background:#18212a;color:white;min-width:230px}button{background:#16673a;color:white;cursor:pointer}button:disabled{opacity:.5}section{margin-top:28px}article{background:#19232b;border:1px solid #34434c;border-radius:10px;padding:16px;margin:10px 0}article p{white-space:pre-wrap;color:#e0e8ed}article img{max-width:180px;max-height:180px;margin:6px;border-radius:6px}small{color:#aab9c3}a{color:#7ec7ff}.error{color:#ff9b91}
</style></head><body>
<h1>WhatsApp operator inbox</h1><p>Enter the agent admin key to see handoffs and messages that need review. This page refreshes every 15 seconds while open.</p>
<label>Admin key <input id="key" type="password" autocomplete="off"></label> <button id="connect">Connect</button><p id="status"></p>
<button id="self-test" disabled>Test Kimi and Meta connections</button><p id="test-result"></p>
<section><h2>MCP connection</h2><p>Connect a remote MCP server with OAuth. For a public OAuth client, leave the client secret blank. Register this callback URL with the provider. Leave allowed tools blank to expose every tool from the server:</p><code id="callback-url"></code><div style="margin-top:10px"><input id="mcp-url" placeholder="https://mcp.notion.com/mcp" autocomplete="url"><input id="mcp-client-id" placeholder="OAuth client ID" autocomplete="off"><input id="mcp-client-secret" type="password" placeholder="Client secret (optional)" autocomplete="off"><input id="mcp-tools" placeholder="Allowed tools (blank = all)" autocomplete="off"><button id="mcp-connect" disabled>Connect MCP</button></div><p id="mcp-status"></p></section>
<section><h2>Orders <span id="order-count"></span></h2><p>Send “Please note this order” to the bot from +91 95370 97267, followed by the party, location, and marked photos. Pending orders are sent at noon India time.</p><div id="orders"></div></section>
<section><h2>Human handoffs <span id="handoff-count"></span></h2><div id="handoffs"></div></section>
<section><h2>Needs review <span id="review-count"></span></h2><div id="review"></div></section>
<script>
let key = '';
const imageUrls = new Map();
const el = id => document.getElementById(id);
const node = (tag, value) => { const item = document.createElement(tag); item.textContent = value; return item; };
async function api(path, options = {}) {
  const result = await fetch(path, { ...options, headers: { 'x-agent-admin-key': key, 'content-type': 'application/json' } });
  if (!result.ok) throw new Error(result.status === 401 ? 'Wrong admin key' : 'Request failed (' + result.status + ')');
  return result.json();
}
async function refresh() {
  if (!key) return;
  try {
    const [handoffs, review, orders, mcp] = await Promise.all([api('/admin/handoffs'), api('/admin/review'), api('/admin/orders'), api('/admin/mcp/status')]);
    el('status').textContent = 'Connected · last checked ' + new Date().toLocaleTimeString();
    el('status').className = '';
    el('self-test').disabled = false;
    el('mcp-connect').disabled = false;
    el('mcp-status').textContent = mcp.connected ? 'Connected: ' + mcp.serverUrl + ' · ' + (mcp.tools?.length || 0) + ' tools discovered' : 'Not connected';
    el('mcp-status').className = mcp.connected ? '' : 'error';
    el('handoff-count').textContent = '(' + handoffs.handoffs.length + ')';
    el('review-count').textContent = '(' + review.messages.length + ')';
    el('order-count').textContent = '(' + orders.orders.filter(o => o.status === 'pending').length + ' pending)';
    document.title = (handoffs.handoffs.length + review.messages.length + orders.orders.filter(o => o.status === 'pending').length ? '● ' : '') + 'Chandni WhatsApp inbox';
    const visibleImages = new Set(orders.orders.flatMap(order => order.items.filter(item => item.kind === 'image').map(item => item.message_id)));
    for (const [id, url] of imageUrls) if (!visibleImages.has(id)) { URL.revokeObjectURL(url); imageUrls.delete(id); }
    el('orders').replaceChildren();
    for (const order of orders.orders) {
      const card = document.createElement('article');
      card.append(node('strong', 'Order #' + order.id + ' · ' + order.status), node('p', order.notes || 'No notes'));
      if (order.party || order.location) card.append(node('small', [order.party, order.location].filter(Boolean).join(' · ')));
      for (const item of order.items.filter(i => i.kind === 'image')) {
        if (!imageUrls.has(item.message_id)) {
          const result = await fetch('/admin/order-image?id=' + encodeURIComponent(item.message_id), { headers: { 'x-agent-admin-key': key } });
          if (result.ok) imageUrls.set(item.message_id, URL.createObjectURL(await result.blob()));
        }
        if (imageUrls.has(item.message_id)) {
          const img = document.createElement('img'); img.src = imageUrls.get(item.message_id); img.alt = 'Order photo'; card.append(img);
        }
      }
      if (order.status === 'pending') {
        const button = node('button', 'Mark completed');
        button.onclick = async () => { button.disabled = true; try { await api('/admin/orders/complete', { method:'POST', body:JSON.stringify({ id:order.id }) }); await refresh(); } catch (error) { el('status').textContent = error.message; button.disabled = false; } };
        card.append(button);
      }
      el('orders').append(card);
    }
    if (!orders.orders.length) el('orders').append(node('p', 'No orders recorded yet.'));
    el('handoffs').replaceChildren();
    for (const item of handoffs.handoffs) {
      const card = document.createElement('article');
      card.append(node('strong', '+' + item.wa_id), node('p', item.latest_message || 'No message text'));
      const link = document.createElement('a'); link.href = 'https://wa.me/' + encodeURIComponent(item.wa_id); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open WhatsApp';
      const button = node('button', 'Resume bot'); button.style.marginLeft = '14px';
      button.onclick = async () => { button.disabled = true; try { await api('/admin/resume', { method:'POST', body:JSON.stringify({ waId:item.wa_id }) }); await refresh(); } catch (error) { el('status').textContent = error.message; el('status').className = 'error'; button.disabled = false; } };
      card.append(link, button); el('handoffs').append(card);
    }
    if (!handoffs.handoffs.length) el('handoffs').append(node('p', 'No handoffs waiting.'));
    el('review').replaceChildren();
    for (const item of review.messages) {
      const card = document.createElement('article');
      card.append(node('strong', '+' + item.wa_id + ' · ' + item.status), node('p', item.body || ''), node('small', item.last_error || 'Send may have started; check Graph before retrying.'));
      el('review').append(card);
    }
    if (!review.messages.length) el('review').append(node('p', 'No messages need review.'));
  } catch (error) { el('status').textContent = error.message; el('status').className = 'error'; }
}
el('connect').onclick = () => {
  key = el('key').value.trim();
  el('key').value = '';
  if (!key) { el('status').textContent = 'Enter the admin key first.'; el('status').className = 'error'; return; }
  el('status').textContent = 'Connecting...';
  el('status').className = '';
  refresh();
};
el('callback-url').textContent = location.origin + '/admin/mcp/oauth/callback';
el('mcp-connect').onclick = async () => {
  const button = el('mcp-connect'); button.disabled = true; el('mcp-status').textContent = 'Starting OAuth...'; el('mcp-status').className = '';
  try {
    const result = await api('/admin/mcp/oauth/start', { method: 'POST', body: JSON.stringify({ serverUrl: el('mcp-url').value.trim(), clientId: el('mcp-client-id').value.trim(), clientSecret: el('mcp-client-secret').value, allowedTools: el('mcp-tools').value }) });
    const popup = window.open(result.url, 'mcp-oauth', 'popup,width=620,height=760');
    if (!popup) throw new Error('Please allow popups for the OAuth sign-in window.');
  } catch (error) { el('mcp-status').textContent = error.message; el('mcp-status').className = 'error'; }
  button.disabled = false;
};
window.addEventListener('message', event => { if (event.origin === location.origin && event.data?.type === 'mcp-oauth') refresh(); });
el('self-test').onclick = async () => {
  el('self-test').disabled = true;
  el('test-result').textContent = 'Checking connections...';
  try {
    const result = await api('/admin/self-test', { method: 'POST' });
    el('test-result').textContent = 'Catalog: ' + result.catalog.pricedDesigns + ' priced designs · Kimi: ' + (result.kimi.ok ? 'ready' : result.kimi.error) + ' · Meta: ' + (result.meta.ok ? 'production phone accessible' : result.meta.error) + (result.subscribedApps ? ' · Subscribed apps: ' + (result.subscribedApps.ok ? result.subscribedApps.detail : result.subscribedApps.error) : '');
  } catch (error) { el('test-result').textContent = error.message; }
  el('self-test').disabled = false;
};
setInterval(refresh, 15000);
</script></body></html>`;

export const CHAT_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chandni operator chat</title><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif}body{max-width:820px;margin:0 auto;padding:24px;background:#10151b;color:#ecf2f5}h1{font-size:1.5rem}p,small{color:#b7c3cb}.bar{display:flex;gap:8px;align-items:center}.bar input{flex:1}input,textarea,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #42515b}input,textarea{background:#18212a;color:white;box-sizing:border-box}button{background:#16673a;color:white;cursor:pointer}button:disabled{opacity:.5}.chat{min-height:420px;margin:20px 0;padding:14px;background:#19232b;border:1px solid #34434c;border-radius:10px;overflow:auto}.bubble{max-width:78%;padding:10px 12px;margin:10px 0;border-radius:10px;white-space:pre-wrap}.user{margin-left:auto;background:#155a39}.assistant{background:#2a3540}.error{color:#ff9b91}textarea{width:100%;min-height:80px;resize:vertical}.actions{display:flex;justify-content:space-between;align-items:center;margin-top:8px}a{color:#7ec7ff}
</style></head><body>
<h1>Private operator chat</h1><p>Test the same sales agent and connected MCP tools without sending anything to WhatsApp.</p>
<div class="bar"><input id="key" type="password" placeholder="Agent admin key" autocomplete="off"><button id="connect">Connect</button><a href="/admin">Admin inbox</a></div><p id="status"></p>
<div id="chat" class="chat"></div><textarea id="message" placeholder="Type a customer message to test..."></textarea><div class="actions"><small>Text-only test console · WhatsApp is never contacted</small><button id="send" disabled>Send</button></div>
<script>
let key='';let sessionId=localStorage.getItem('chandni-operator-chat-session')||crypto.randomUUID();localStorage.setItem('chandni-operator-chat-session',sessionId);
const el=id=>document.getElementById(id);const add=(role,text)=>{const item=document.createElement('div');item.className='bubble '+role;item.textContent=text;el('chat').append(item);el('chat').scrollTop=el('chat').scrollHeight;};
async function api(path,options={}){const result=await fetch(path,{...options,headers:{'x-agent-admin-key':key,'content-type':'application/json',...(options.headers||{})}});if(!result.ok)throw new Error(result.status===401?'Wrong admin key':'Request failed ('+result.status+')');return result.json();}
el('connect').onclick=async()=>{key=el('key').value.trim();el('key').value='';if(!key){el('status').textContent='Enter the admin key first.';el('status').className='error';return;}el('status').textContent='Connected';el('status').className='';el('send').disabled=false;try{const result=await api('/admin/chat/history?sessionId='+encodeURIComponent(sessionId));el('chat').replaceChildren();for(const item of result.messages)add(item.role,item.content);}catch(error){el('status').textContent=error.message;el('status').className='error';}};
async function send(){const text=el('message').value.trim();if(!text||!key)return;el('message').value='';add('user',text);el('send').disabled=true;el('status').textContent='Thinking...';try{const result=await api('/admin/chat/message',{method:'POST',body:JSON.stringify({sessionId,message:text})});add('assistant',result.reply);el('status').textContent=result.tools?.length?'Replied · MCP: '+result.tools.join(', '):result.mcpAvailable?'Replied · MCP available ('+result.mcpToolCount+' tools), no tool used':'Replied · MCP unavailable';}catch(error){el('status').textContent=error.message;el('status').className='error';}el('send').disabled=false;el('message').focus();}
el('send').onclick=send;el('message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send();}});
</script></body></html>`;
