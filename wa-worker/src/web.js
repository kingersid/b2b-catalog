const MAX_PAGE_BYTES = 128 * 1024;
const MAX_TEXT_CHARS = 16000;

function publicUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new Error('Enter an absolute web URL'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only public HTTP(S) pages can be opened');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are not allowed');
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test')
    || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':')) throw new Error('Local or IP-address targets are not allowed');
  if (url.port) throw new Error('Non-standard web ports are not allowed');
  url.hash = '';
  return url;
}

async function limitedText(response) {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_PAGE_BYTES - size;
      if (value.byteLength > remaining) {
        if (remaining) parts.push(value.slice(0, remaining));
        size = MAX_PAGE_BYTES;
        truncated = true;
        await reader.cancel();
        break;
      }
      size += value.byteLength;
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return { text: new TextDecoder().decode(bytes), truncated };
}

export async function fetchPublicPage(value, fetchFn = fetch) {
  let url = publicUrl(value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    for (let redirect = 0; redirect <= 3; redirect++) {
      const response = await fetchFn(url.toString(), {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { accept: 'text/html, text/plain, application/json, application/xml' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Web redirect has no location');
        url = publicUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) throw new Error(`Web page HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!/^(text\/|application\/(?:json|xml|xhtml\+xml))/i.test(contentType)) throw new Error('Web page is not readable text');
      const page = await limitedText(response);
      let content = page.text;
      const title = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(content)?.[1]?.replace(/\s+/g, ' ').trim() || null;
      if (/html|xml/i.test(contentType)) content = content
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
      content = content.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim().slice(0, MAX_TEXT_CHARS);
      return JSON.stringify({ url: url.toString(), title, content, truncated: page.truncated });
    }
    throw new Error('Too many web redirects');
  } finally { clearTimeout(timeout); }
}
