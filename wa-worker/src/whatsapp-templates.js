const GRAPH = 'https://graph.facebook.com/v21.0';
const MAX_RESPONSE_BYTES = 65536;
const DRAFT_LIFETIME = 15 * 60;

export const PAYMENT_TEMPLATE_NAME = 'chandni_payment_pending_hi';
export const PAYMENT_TEMPLATE_BODY = 'नमस्ते {{1}},\n\nचाँदनी सिल्क मिल्स से कपड़ों का ऑर्डर देने के लिए धन्यवाद। हमारे रिकॉर्ड के अनुसार, दिनांक {{2}} के आपके ऑर्डर की ₹{{3}} राशि का भुगतान लंबित है। कृपया बताएं कि भुगतान कब तक हो सकेगा।\n\nधन्यवाद,\nचाँदनी सिल्क मिल्स';

export const PAYMENT_TEMPLATE_SPEC = {
  name: PAYMENT_TEMPLATE_NAME,
  language: 'hi',
  category: 'UTILITY',
  components: [{
    type: 'BODY',
    text: PAYMENT_TEMPLATE_BODY,
    example: { body_text: [['राहुल जी', '15 सितंबर 2026', '12,500']] },
  }],
};

async function readJson(response) {
  if (!response.body) throw new Error('Meta returned an empty response');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Meta response is too large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('Meta returned invalid JSON'); }
}

async function graph(env, path, options = {}, fetchFn = fetch) {
  if (!env.META_ACCESS_TOKEN) throw new Error('META_ACCESS_TOKEN is not configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchFn(`${GRAPH}/${path}`, {
      ...options,
      signal: controller.signal,
      headers: { authorization: `Bearer ${env.META_ACCESS_TOKEN}`, ...(options.body ? { 'content-type': 'application/json' } : {}) },
    });
    const data = await readJson(response);
    if (!response.ok) throw new Error(`Meta HTTP ${response.status}: ${String(data.error?.message || 'Request failed').slice(0, 160)}`);
    return data;
  } finally { clearTimeout(timeout); }
}

function validateTemplateName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9_]{1,128}$/.test(name)) throw new Error('Choose a valid approved template name');
  return name;
}

function validateLanguage(language) {
  if (typeof language !== 'string' || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)) throw new Error('Choose a valid template language');
  return language;
}

export function validateRecipient(value) {
  const phone = String(value || '').replace(/[\s()+-]/g, '');
  if (!/^[1-9]\d{10,14}$/.test(phone)) throw new Error('Enter a recipient number with country code');
  return phone;
}

function validateParameters(values) {
  if (!Array.isArray(values) || values.length > 10) throw new Error('Provide up to ten template body values');
  return values.map(value => {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Template values must be text or numbers');
    const text = String(value).trim();
    if (!text || text.length > 160 || /[\r\n]/.test(text)) throw new Error('Each template value must be one nonempty line');
    return text;
  });
}

export function renderTemplate(template, values) {
  const components = Array.isArray(template.components) ? template.components : [];
  if (components.some(component => !['BODY', 'HEADER', 'FOOTER'].includes(component.type)
    || (component.type === 'HEADER' && component.format && component.format !== 'TEXT')
    || (component.type !== 'BODY' && /\{\{/.test(component.text || '')))) {
    throw new Error('This template uses headers or buttons that the chat sender does not support yet');
  }
  const body = components.find(component => component.type === 'BODY')?.text;
  if (typeof body !== 'string' || !body) throw new Error('Template has no text body');
  const slots = [...body.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1]));
  const count = slots.length ? Math.max(...slots) : 0;
  if (count !== values.length || [...new Set(slots)].length !== count || slots.some(slot => slot < 1 || slot > 10)) {
    throw new Error(`Template requires ${count} body values`);
  }
  const filled = body.replace(/\{\{(\d+)\}\}/g, (_, position) => values[Number(position) - 1]);
  const header = components.find(component => component.type === 'HEADER')?.text;
  const footer = components.find(component => component.type === 'FOOTER')?.text;
  return [header, filled, footer].filter(Boolean).join('\n\n');
}

export async function getTemplate(env, name, language, fetchFn = fetch) {
  validateTemplateName(name);
  validateLanguage(language);
  const params = new URLSearchParams({ name, fields: 'name,language,status,category,components', limit: '100' });
  const data = await graph(env, `${env.WABA_ID}/message_templates?${params}`, {}, fetchFn);
  return Array.isArray(data.data) ? data.data.find(row => row.name === name && row.language === language) || null : null;
}

export async function paymentTemplateStatus(env, fetchFn = fetch) {
  const template = await getTemplate(env, PAYMENT_TEMPLATE_NAME, 'hi', fetchFn);
  return { name: PAYMENT_TEMPLATE_NAME, language: 'hi', status: template?.status || 'NOT_SUBMITTED', category: template?.category || 'UTILITY' };
}

export async function submitPaymentTemplate(env, fetchFn = fetch) {
  const current = await paymentTemplateStatus(env, fetchFn);
  if (current.status !== 'NOT_SUBMITTED') return current;
  const data = await graph(env, `${env.WABA_ID}/message_templates`, { method: 'POST', body: JSON.stringify(PAYMENT_TEMPLATE_SPEC) }, fetchFn);
  return { name: PAYMENT_TEMPLATE_NAME, language: 'hi', status: data.status || 'PENDING', category: data.category || 'UTILITY', id: data.id };
}

export async function prepareWhatsAppTemplate(env, sessionId, input, fetchFn = fetch) {
  const to = validateRecipient(input.to);
  const templateName = validateTemplateName(input.template_name);
  const language = validateLanguage(input.language);
  const values = validateParameters(input.body_parameters);
  const template = await getTemplate(env, templateName, language, fetchFn);
  if (!template) throw new Error('Template not found in the production WhatsApp account');
  if (template.status !== 'APPROVED') throw new Error(`Template is ${template.status || 'not approved'}; wait for Meta approval`);
  if (templateName === PAYMENT_TEMPLATE_NAME && template.category !== 'UTILITY') throw new Error('Payment reminder must be approved as a Utility template');
  const preview = renderTemplate(template, values);
  const id = crypto.randomUUID();
  const stamp = Math.floor(Date.now() / 1000);
  await env.CATALOG_DB.prepare(`INSERT INTO wa_operator_whatsapp_drafts
    (id, session_id, to_wa_id, template_name, language, parameters_json, preview, category, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .bind(id, sessionId, to, templateName, language, JSON.stringify(values), preview, template.category || 'UNKNOWN', stamp, stamp).run();
  return { id, to, templateName, language, preview, category: template.category || 'UNKNOWN', expiresAt: stamp + DRAFT_LIFETIME };
}

export async function pendingWhatsAppTemplates(env, sessionId) {
  const stamp = Math.floor(Date.now() / 1000);
  const { results } = await env.CATALOG_DB.prepare(`SELECT id, to_wa_id, template_name, language, preview, category, created_at
    FROM wa_operator_whatsapp_drafts WHERE session_id = ? AND status = 'pending' AND created_at > ? ORDER BY created_at DESC LIMIT 5`)
    .bind(sessionId, stamp - DRAFT_LIFETIME).all();
  return results.map(row => ({ id: row.id, to: row.to_wa_id, templateName: row.template_name,
    language: row.language, preview: row.preview, category: row.category, expiresAt: row.created_at + DRAFT_LIFETIME }));
}

export async function confirmWhatsAppTemplate(env, id, optInConfirmed, fetchFn = fetch) {
  if (!optInConfirmed) throw new Error('Confirm the recipient agreed to receive WhatsApp updates');
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid draft');
  const row = await env.CATALOG_DB.prepare('SELECT * FROM wa_operator_whatsapp_drafts WHERE id = ?').bind(id).first();
  const stamp = Math.floor(Date.now() / 1000);
  if (!row || row.status !== 'pending' || row.created_at <= stamp - DRAFT_LIFETIME) throw new Error('Draft is no longer available');
  const values = JSON.parse(row.parameters_json);
  const template = await getTemplate(env, row.template_name, row.language, fetchFn);
  if (!template || template.status !== 'APPROVED' || renderTemplate(template, values) !== row.preview
    || (template.category || 'UNKNOWN') !== row.category) throw new Error('Template changed or is no longer approved; prepare a new draft');
  const claimed = await env.CATALOG_DB.prepare(`UPDATE wa_operator_whatsapp_drafts SET status = 'sending', updated_at = ?
    WHERE id = ? AND status = 'pending'`).bind(stamp, id).run();
  if (claimed.meta.changes !== 1) throw new Error('Draft was already submitted');
  const payload = { messaging_product: 'whatsapp', to: row.to_wa_id, type: 'template', template: {
    name: row.template_name, language: { code: row.language },
    ...(values.length ? { components: [{ type: 'body', parameters: values.map(text => ({ type: 'text', text })) }] } : {}),
  } };
  try {
    const data = await graph(env, `${env.PHONE_NUMBER_ID}/messages`, { method: 'POST', body: JSON.stringify(payload) }, fetchFn);
    const messageId = data.messages?.[0]?.id;
    if (!messageId) throw new Error('Meta did not return a message ID; delivery status is uncertain');
    await env.CATALOG_DB.prepare(`UPDATE wa_operator_whatsapp_drafts SET status = 'sent', graph_message_id = ?, updated_at = ? WHERE id = ?`)
      .bind(messageId, Math.floor(Date.now() / 1000), id).run();
    return { sent: true, messageId, to: row.to_wa_id, preview: row.preview };
  } catch (error) {
    await env.CATALOG_DB.prepare(`UPDATE wa_operator_whatsapp_drafts SET status = 'unknown', last_error = ?, updated_at = ? WHERE id = ?`)
      .bind(String(error.message).slice(0, 200), Math.floor(Date.now() / 1000), id).run();
    throw error;
  }
}
