import { callMcpTool, connectMcp } from './mcp.js';
import { storedMcpConnection } from './mcp-oauth.js';

const URL = 'https://mcp.sarvam.ai/voice-agents';
const WRITE_TOOLS = new Set(['configure_campaign', 'upload_cohort']);
const READ_TOOLS = new Set(['agents', 'telephony', 'campaigns', 'analytics', 'evals', 'knowledge_base']);
const READ_OPERATION = /^(list|get|read|search|inspect|describe|fetch|retrieve|query)(?:_|$)/i;
const TEST_PHONE = '919537097267';
const now = () => Math.floor(Date.now() / 1000);

export async function sarvamConnection(env, fetchFn = fetch) {
  const config = await storedMcpConnection(env, fetchFn, 2);
  if (!config) return null;
  if (config.serverUrl !== URL) throw new Error('Sarvam MCP URL mismatch');
  return connectMcp(env, fetchFn, config);
}

export function sarvamModelTools(connection) {
  return (connection?.tools || []).filter(tool => READ_TOOLS.has(tool.name) || WRITE_TOOLS.has(tool.name));
}

export function isSarvamRead(name, args) {
  return READ_TOOLS.has(name) && READ_OPERATION.test(String(args?.operation || ''));
}

function validateMutation(name, args) {
  if (!WRITE_TOOLS.has(name) && !(name === 'campaigns' && /^pause$/i.test(String(args?.operation || ''))))
    throw new Error('Sarvam action is not approved for operator chat');
  const raw = JSON.stringify(args || {});
  if (raw.length > 12000) throw new Error('Sarvam action is too large to review');
  if (name === 'upload_cohort') {
    const phones = [...raw.matchAll(/\+?91\d{10}/g)].map(match => match[0].replace(/\D/g, ''));
    if (phones.length !== 1 || phones[0] !== TEST_PHONE)
      throw new Error('The first cohort must contain only +91 95370 97267');
  }
  if (name === 'configure_campaign' && /\b(\d{10,})\b/.test(raw)) {
    const phones = [...raw.matchAll(/\+?91\d{10}/g)].map(match => match[0].replace(/\D/g, ''));
    if (phones.some(phone => phone !== TEST_PHONE && phone !== '917971170755'))
      throw new Error('The first campaign may only use the registered caller and one test recipient');
  }
  return raw;
}

export async function stageSarvamMutation(env, sessionId, name, args) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) throw new Error('Invalid operator session');
  const payload = validateMutation(name, args);
  const id = crypto.randomUUID();
  await env.CATALOG_DB.prepare(`INSERT INTO wa_operator_sarvam_actions
    (id, session_id, tool_name, arguments_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)`).bind(id, sessionId, name, payload, now(), now()).run();
  return { id, toolName: name, arguments: args, status: 'pending' };
}

export async function pendingSarvamActions(env, sessionId) {
  const { results } = await env.CATALOG_DB.prepare(`SELECT id, tool_name, arguments_json, status, result_json
    FROM wa_operator_sarvam_actions WHERE session_id = ? AND status IN ('pending','running','unknown') ORDER BY created_at DESC LIMIT 10`)
    .bind(sessionId).all();
  return results.map(row => ({ id: row.id, toolName: row.tool_name, arguments: JSON.parse(row.arguments_json),
    status: row.status, result: row.result_json ? JSON.parse(row.result_json) : null }));
}

export async function confirmSarvamAction(env, id, fetchFn = fetch) {
  const row = await env.CATALOG_DB.prepare('SELECT * FROM wa_operator_sarvam_actions WHERE id = ?').bind(id).first();
  if (!row || row.status !== 'pending') throw new Error('Sarvam action is unavailable or already used');
  const args = JSON.parse(row.arguments_json);
  validateMutation(row.tool_name, args);
  const lock = await env.CATALOG_DB.prepare("UPDATE wa_operator_sarvam_actions SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'")
    .bind(now(), id).run();
  if (!lock.meta?.changes) throw new Error('Sarvam action is already in progress');
  try {
    const connection = await sarvamConnection(env, fetchFn);
    if (!connection) throw new Error('Connect Sarvam MCP first');
    if (!connection.tools.some(tool => tool.name === row.tool_name)) throw new Error('Sarvam tool is no longer available');
    const raw = await callMcpTool(connection, row.tool_name, args, fetchFn);
    const result = JSON.parse(raw);
    if (result.isError) throw new Error(`Sarvam rejected action: ${String(result.content).slice(0, 200)}`);
    await env.CATALOG_DB.prepare("UPDATE wa_operator_sarvam_actions SET status = 'completed', result_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(result).slice(0, 6000), now(), id).run();
    return { status: 'completed', toolName: row.tool_name, result };
  } catch (error) {
    await env.CATALOG_DB.prepare("UPDATE wa_operator_sarvam_actions SET status = 'unknown', result_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify({ error: String(error.message).slice(0, 300) }), now(), id).run();
    throw error;
  }
}
