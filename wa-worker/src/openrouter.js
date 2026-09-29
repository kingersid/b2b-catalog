import { seal, unseal } from './mcp-oauth.js';

const ORIGIN = 'https://openrouter.ai/api/v1';
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;

async function readBounded(response, limit = MAX_CATALOG_BYTES) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error('OpenRouter response is too large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export function isFreeOpenRouterModel(id) {
  return id === 'openrouter/free' || id.endsWith(':free');
}

function perMillion(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value) * 1e6;
  return Number.isFinite(amount) ? amount : null;
}

export function validateOpenRouterSelection(model, freeOnly = false) {
  if (typeof model !== 'string' || model.length > 150 || !/^[~a-zA-Z0-9][a-zA-Z0-9._~:-]*\/[a-zA-Z0-9][a-zA-Z0-9._~:-]*$/.test(model)) {
    throw new Error('Choose an OpenRouter model from the picker');
  }
  if (freeOnly && !isFreeOpenRouterModel(model)) throw new Error('Free-only mode requires a free OpenRouter model');
  return model;
}

export async function openRouterKey(env) {
  const row = await env.CATALOG_DB.prepare('SELECT api_key FROM wa_operator_openrouter WHERE id = 1').first();
  return row?.api_key ? unseal(row.api_key, env.AGENT_ADMIN_KEY) : env.OPENROUTER_API_KEY || null;
}

export async function openRouterStatus(env) {
  return { connected: Boolean(await openRouterKey(env)) };
}

export async function saveOpenRouterKey(env, value, fetchFn = fetch) {
  const key = String(value || '').trim();
  if (key.length < 20 || key.length > 256 || /\s/.test(key)) throw new Error('Enter a valid OpenRouter API key');
  const response = await fetchFn(`${ORIGIN}/key`, { headers: { authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error(response.status === 401 ? 'OpenRouter rejected this API key' : `OpenRouter key check failed (${response.status})`);
  await readBounded(response, 16384);
  const encrypted = await seal(key, env.AGENT_ADMIN_KEY);
  await env.CATALOG_DB.prepare(`INSERT INTO wa_operator_openrouter (id, api_key, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET api_key = excluded.api_key, updated_at = excluded.updated_at`)
    .bind(encrypted, Math.floor(Date.now() / 1000)).run();
  return { connected: true };
}

export async function listOpenRouterModels(env, fetchFn = fetch) {
  const key = await openRouterKey(env);
  if (!key) throw new Error('Connect an OpenRouter API key first');
  const url = `${ORIGIN}/models?supported_parameters=tools&output_modalities=text`;
  const response = await fetchFn(url, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } });
  const raw = await readBounded(response);
  if (!response.ok) throw new Error(response.status === 401 ? 'OpenRouter API key rejected' : `OpenRouter models HTTP ${response.status}`);
  const data = JSON.parse(raw);
  if (!Array.isArray(data.data)) throw new Error('OpenRouter returned an invalid model list');
  return data.data.filter(model => typeof model.id === 'string' && Array.isArray(model.supported_parameters)
    && model.supported_parameters.includes('tools'))
    .map(model => ({
      id: model.id,
      name: String(model.name || model.id).slice(0, 150),
      free: isFreeOpenRouterModel(model.id),
      promptPrice: perMillion(model.pricing?.prompt),
      completionPrice: perMillion(model.pricing?.completion),
      contextLength: Number(model.context_length || 0),
    })).slice(0, 1000);
}
