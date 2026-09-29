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
:root{color-scheme:dark;font-family:system-ui,sans-serif}body{max-width:820px;margin:0 auto;padding:24px;background:#10151b;color:#ecf2f5}h1{font-size:1.5rem}p,small{color:#b7c3cb}.bar{display:flex;gap:8px;align-items:center;margin:8px 0}.bar input{flex:1}input,textarea,button,select{font:inherit;padding:10px;border-radius:8px;border:1px solid #42515b}input,textarea,select{background:#18212a;color:white;box-sizing:border-box}button{background:#16673a;color:white;cursor:pointer}button:disabled{opacity:.5}.chat{min-height:420px;margin:20px 0;padding:14px;background:#19232b;border:1px solid #34434c;border-radius:10px;overflow:auto}.bubble{max-width:78%;padding:10px 12px;margin:10px 0;border-radius:10px;white-space:pre-wrap}.user{margin-left:auto;background:#155a39}.assistant{background:#2a3540}.error{color:#ff9b91}textarea{width:100%;min-height:80px;resize:vertical}.actions{display:flex;justify-content:space-between;align-items:center;margin-top:8px}a{color:#7ec7ff}.provider{margin-top:18px;padding:12px;border:1px solid #34434c;border-radius:10px}.provider select{flex:1;min-width:0}.provider label{white-space:nowrap}.provider .bar{flex-wrap:wrap}.provider input[type=checkbox]{flex:none}.provider small{display:block;margin:6px 0}
</style></head><body>
<h1>Private operator chat</h1><p>Your general-purpose assistant can use Notion and Tavily web tools here. WhatsApp customer replies remain on the separate sales path.</p>
<div class="bar"><input id="key" type="password" placeholder="Agent admin key" autocomplete="off"><button id="connect">Connect</button><a href="/admin">Admin inbox</a></div><p id="status"></p>
<div class="bar"><input id="tavily-key" type="password" placeholder="Tavily MCP URL or API key (operator only)" autocomplete="off"><button id="tavily-connect" disabled>Connect Tavily MCP</button></div><p id="tools-status">Connect to check available tools.</p>
<div class="provider"><div class="bar"><label for="provider">Inference provider</label><select id="provider"><option value="kimi">Kimi</option><option value="openrouter">OpenRouter</option></select></div>
<div id="or-settings" hidden><div class="bar"><input id="or-key" type="password" placeholder="OpenRouter API key (stored encrypted)" autocomplete="off"><button id="or-connect" disabled>Connect OpenRouter</button></div>
<small>OpenRouter receives your operator chat and any Notion or web tool results sent to the selected model provider.</small><p id="or-status">Connect an OpenRouter key to load models.</p>
<div class="bar"><label><input id="free-only" type="checkbox"> Free only</label><input id="model-search" type="search" placeholder="Search tool-capable models..."></div>
<div class="bar"><label for="model">Model</label><select id="model"><option value="">Connect OpenRouter first</option></select></div><small>Prices shown are OpenRouter's current USD per million input/output tokens. Free-only uses explicit free model variants.</small></div></div>
<div id="chat" class="chat"></div><textarea id="message" placeholder="Ask about the web, your Notion workspace, or anything else..."></textarea><div class="actions"><small>Private operator session · no WhatsApp messages are sent</small><div><button id="new-chat" type="button">New chat</button> <button id="send" disabled>Send</button></div></div>
<script>
let key='';let sessionId=localStorage.getItem('chandni-operator-chat-session')||crypto.randomUUID();localStorage.setItem('chandni-operator-chat-session',sessionId);let models=[];
const el=id=>document.getElementById(id);const add=(role,text)=>{const item=document.createElement('div');item.className='bubble '+role;item.textContent=text;el('chat').append(item);el('chat').scrollTop=el('chat').scrollHeight;};
async function api(path,options={}){const result=await fetch(path,{...options,headers:{'x-agent-admin-key':key,'content-type':'application/json',...(options.headers||{})}});const data=await result.json().catch(()=>({}));if(!result.ok)throw new Error(result.status===401?'Wrong admin key':data.error||'Request failed ('+result.status+')');return data;}
async function refreshTools(){try{const result=await api('/admin/operator/tools/status');el('tools-status').textContent='Notion: '+(result.notion.length?result.notion.length+' tools ready':'unavailable')+' · Tavily web: '+(result.tavily.length?result.tavily.length+' tools ready':'not connected');}catch(error){el('tools-status').textContent=error.message;el('tools-status').className='error';}}
function modelPrice(value){return value===null?'?':'$'+value.toLocaleString('en-US',{maximumSignificantDigits:3});}
function renderModels(){const query=el('model-search').value.trim().toLowerCase();const free=el('free-only').checked;const selected=el('model').value||localStorage.getItem('chandni-operator-model')||'';const visible=models.filter(item=>(!free||item.free)&&(!query||(item.name+' '+item.id).toLowerCase().includes(query)));el('model').replaceChildren();for(const item of visible){const price=item.free?'Free':modelPrice(item.promptPrice)+' / '+modelPrice(item.completionPrice);el('model').add(new Option(item.name+' · '+price+' · '+item.id,item.id));}if(visible.some(item=>item.id===selected))el('model').value=selected;if(!visible.length)el('model').add(new Option(models.length?'No matching models':'Connect OpenRouter first',''));if(el('model').value)localStorage.setItem('chandni-operator-model',el('model').value);el('or-status').textContent=models.length?visible.length+' of '+models.length+' tool-capable models shown':'Connect an OpenRouter key to load models.';el('or-status').className='';}
async function refreshProvider(){el('or-settings').hidden=el('provider').value!=='openrouter';if(el('provider').value!=='openrouter'||!key)return;try{const status=await api('/admin/operator/openrouter/status');if(!status.connected){models=[];renderModels();return;}el('or-status').textContent='Loading OpenRouter models...';const result=await api('/admin/operator/openrouter/models');models=result.models;renderModels();}catch(error){el('or-status').textContent=error.message;el('or-status').className='error';}}
el('provider').value=localStorage.getItem('chandni-operator-provider')==='openrouter'?'openrouter':'kimi';el('free-only').checked=localStorage.getItem('chandni-operator-free')==='true';el('provider').onchange=()=>{localStorage.setItem('chandni-operator-provider',el('provider').value);refreshProvider();};el('free-only').onchange=()=>{localStorage.setItem('chandni-operator-free',String(el('free-only').checked));renderModels();};el('model-search').oninput=renderModels;el('model').onchange=()=>localStorage.setItem('chandni-operator-model',el('model').value);refreshProvider();
el('connect').onclick=async()=>{key=el('key').value.trim();el('key').value='';if(!key){el('status').textContent='Enter the admin key first.';el('status').className='error';return;}el('status').textContent='Connected';el('status').className='';el('send').disabled=false;el('tavily-connect').disabled=false;el('or-connect').disabled=false;try{const result=await api('/admin/chat/history?sessionId='+encodeURIComponent(sessionId));el('chat').replaceChildren();for(const item of result.messages)add(item.role,item.content);await refreshTools();await refreshProvider();}catch(error){el('status').textContent=error.message;el('status').className='error';}};
el('tavily-connect').onclick=async()=>{const apiKey=el('tavily-key').value.trim();if(!apiKey){el('tools-status').textContent='Enter a Tavily MCP URL or API key first.';return;}el('tavily-connect').disabled=true;el('tools-status').textContent='Checking Tavily MCP...';try{const result=await api('/admin/operator/tavily/connect',{method:'POST',body:JSON.stringify({apiKey})});el('tavily-key').value='';el('tools-status').className='';el('tools-status').textContent='Tavily connected · '+result.tools.length+' tools ready';await refreshTools();}catch(error){el('tools-status').textContent=error.message;el('tools-status').className='error';}el('tavily-connect').disabled=false;};
el('or-connect').onclick=async()=>{const apiKey=el('or-key').value.trim();if(!apiKey){el('or-status').textContent='Enter your OpenRouter API key first.';return;}el('or-connect').disabled=true;el('or-status').textContent='Checking OpenRouter key...';try{await api('/admin/operator/openrouter/connect',{method:'POST',body:JSON.stringify({apiKey})});el('or-key').value='';el('or-status').className='';await refreshProvider();}catch(error){el('or-status').textContent=error.message;el('or-status').className='error';}el('or-connect').disabled=false;};
el('new-chat').onclick=()=>{sessionId=crypto.randomUUID();localStorage.setItem('chandni-operator-chat-session',sessionId);el('chat').replaceChildren();el('status').textContent=key?'New private chat ready.':'Enter the admin key to start a private chat.';el('status').className='';};
async function send(){const text=el('message').value.trim();if(!text||!key)return;const provider=el('provider').value;const model=provider==='openrouter'?el('model').value:'';if(provider==='openrouter'&&!model){el('status').textContent='Connect OpenRouter and select a model first.';el('status').className='error';return;}el('message').value='';add('user',text);el('send').disabled=true;el('status').textContent='Thinking with '+(provider==='openrouter'?model:'Kimi')+'...';el('status').className='';try{const result=await api('/admin/chat/message',{method:'POST',body:JSON.stringify({sessionId,message:text,provider,model,freeOnly:el('free-only').checked})});add('assistant',result.reply);el('status').textContent='Replied · '+(result.provider==='openrouter'?result.model:'Kimi')+(result.tools?.length?' · tools: '+result.tools.join(', '):' · no tool used');}catch(error){el('status').textContent=error.message;el('status').className='error';}el('send').disabled=false;el('message').focus();}
el('send').onclick=send;el('message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send();}});
</script></body></html>`;
