export const ADMIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chandni WhatsApp inbox</title><style>
  :root{color-scheme:dark;font-family:system-ui,sans-serif}body{max-width:900px;margin:0 auto;padding:24px;background:#10151b;color:#ecf2f5}h1{font-size:1.5rem}p{color:#b7c3cb}input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #42515b}input{background:#18212a;color:white;min-width:230px}button{background:#16673a;color:white;cursor:pointer}button:disabled{opacity:.5}section{margin-top:28px}article{background:#19232b;border:1px solid #34434c;border-radius:10px;padding:16px;margin:10px 0}article p{white-space:pre-wrap;color:#e0e8ed}small{color:#aab9c3}a{color:#7ec7ff}.error{color:#ff9b91}
</style></head><body>
<h1>WhatsApp operator inbox</h1><p>Enter the agent admin key to see handoffs and messages that need review. This page refreshes every 15 seconds while open.</p>
<label>Admin key <input id="key" type="password" autocomplete="off"></label> <button id="connect">Connect</button><p id="status"></p>
<button id="self-test" disabled>Test Kimi and Meta connections</button><p id="test-result"></p>
<section><h2>Human handoffs <span id="handoff-count"></span></h2><div id="handoffs"></div></section>
<section><h2>Needs review <span id="review-count"></span></h2><div id="review"></div></section>
<script>
let key = '';
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
    const [handoffs, review] = await Promise.all([api('/admin/handoffs'), api('/admin/review')]);
    el('status').textContent = 'Connected · last checked ' + new Date().toLocaleTimeString();
    el('status').className = '';
    el('self-test').disabled = false;
    el('handoff-count').textContent = '(' + handoffs.handoffs.length + ')';
    el('review-count').textContent = '(' + review.messages.length + ')';
    document.title = (handoffs.handoffs.length + review.messages.length ? '● ' : '') + 'Chandni WhatsApp inbox';
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
