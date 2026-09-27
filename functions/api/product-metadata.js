const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-upload-key',
};
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
});
const fields = ['title', 'fabric_type', 'pattern', 'colors', 'use_cases', 'composition', 'keywords'];
const availabilityValues = new Set(['unknown', 'available', 'low_stock', 'sold_out']);

async function authorized(request, secret) {
  if (!secret) return false;
  const a = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.headers.get('x-upload-key') || ''));
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  if (!await authorized(request, env.UPLOAD_KEY)) return json({ error: 'Unauthorized' }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid JSON body' }, 400);
  const designId = String(body.designId || '').trim();
  if (!designId || designId.length > 255) return json({ error: 'Invalid designId' }, 400);
  const values = {};
  for (const field of fields) {
    if (typeof body[field] !== 'string' || body[field].trim().length > 240) {
      return json({ error: `${field} must be text up to 240 characters` }, 400);
    }
    values[field] = body[field].trim();
  }
  if (!availabilityValues.has(body.availability)) return json({ error: 'Invalid availability' }, 400);
  for (const field of ['width_cm', 'moq_meters']) {
    const value = body[field] === '' || body[field] == null ? null : Number(body[field]);
    if (value != null && (!Number.isFinite(value) || value <= 0 || value > 100000)) {
      return json({ error: `${field} must be a positive number` }, 400);
    }
    values[field] = value;
  }
  const exists = await env.CATALOG_DB.prepare('SELECT design_id FROM designs WHERE design_id = ?').bind(designId).first();
  if (!exists) return json({ error: 'Design not found' }, 404);
  await env.CATALOG_DB.prepare(`
    INSERT INTO design_metadata
      (design_id, title, fabric_type, pattern, colors, use_cases, composition, width_cm, moq_meters, availability, keywords)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(design_id) DO UPDATE SET
      title = excluded.title, fabric_type = excluded.fabric_type, pattern = excluded.pattern,
      colors = excluded.colors, use_cases = excluded.use_cases, composition = excluded.composition,
      width_cm = excluded.width_cm, moq_meters = excluded.moq_meters,
      availability = excluded.availability, keywords = excluded.keywords,
      updated_at = datetime('now')
  `).bind(designId, values.title, values.fabric_type, values.pattern, values.colors,
    values.use_cases, values.composition, values.width_cm, values.moq_meters,
    body.availability, values.keywords).run();
  return json({ ok: true, designId });
}
