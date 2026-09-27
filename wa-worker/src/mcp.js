const MAX_TOOL_COUNT = 100;
const MAX_TOOL_OUTPUT = 6000;
const MCP_PROTOCOL_VERSION = '2025-06-18';

function toolAllowlist(value) {
  return new Set(String(value || '').split(',').map(name => name.trim()).filter(Boolean));
}

async function readMcpResponse(response) {
  const raw = await response.text();
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
  if (!raw.trim()) return null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    const events = raw.split(/\r?\n\r?\n/).flatMap(block => {
      const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') return [];
      try { return [JSON.parse(data)]; } catch { return []; }
    });
    return events.at(-1) || null;
  }
  return JSON.parse(raw);
}

async function rpc(url, method, params, headers, fetchFn, id = 1, session = null) {
  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...headers,
      ...(session?.id ? { 'mcp-session-id': session.id } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const sessionId = response.headers.get('mcp-session-id');
  if (sessionId && session) session.id = sessionId;
  const result = await readMcpResponse(response);
  if (result?.error) throw new Error(`MCP ${method} failed: ${String(result.error.message || 'server error').slice(0, 160)}`);
  return result?.result || {};
}

function normaliseTool(tool) {
  const name = String(tool?.name || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) return null;
  const schema = tool.inputSchema && typeof tool.inputSchema === 'object'
    ? tool.inputSchema
    : { type: 'object', properties: {} };
  return {
    name,
    description: String(tool.description || `MCP tool ${name}`).slice(0, 1000),
    parameters: schema,
  };
}

export async function connectMcp(env, fetchFn = fetch, configured = {}) {
  const url = String(configured.serverUrl || env.MCP_SERVER_URL || '').trim();
  if (!url) return null;
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('MCP_SERVER_URL is not a valid URL'); }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('MCP_SERVER_URL must use HTTPS');
  }
  const token = configured.token || env.MCP_SERVER_TOKEN;
  const headers = token
    ? { authorization: `Bearer ${token}` }
    : {};
  const session = { id: '' };
  const allow = toolAllowlist(configured.allowedTools ?? env.MCP_ALLOWED_TOOLS);
  const init = await rpc(url, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'chandni-whatsapp-agent', version: '1.0.0' },
  }, headers, fetchFn, 1, session);
  // The notification is intentionally best-effort: some stateless servers do
  // not require it and return no body for notifications.
  try {
    await fetchFn(url, {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...headers, ...(session.id ? { 'mcp-session-id': session.id } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    });
  } catch {}
  const listed = await rpc(url, 'tools/list', {}, headers, fetchFn, 2, session);
  const tools = (Array.isArray(listed.tools) ? listed.tools : [])
    .map(normaliseTool)
    .filter(Boolean)
    .filter(tool => !allow.size || allow.has(tool.name))
    .slice(0, MAX_TOOL_COUNT);
  if (!tools.length) return { url, headers, tools: [], sessionId: session.id, serverInfo: init.serverInfo || null };
  return { url, headers, tools, sessionId: session.id, serverInfo: init.serverInfo || null };
}

export async function callMcpTool(connection, name, args, fetchFn = fetch) {
  if (!connection?.tools.some(tool => tool.name === name)) throw new Error(`MCP tool is not allowlisted: ${name}`);
  const session = { id: connection.sessionId || '' };
  const result = await rpc(connection.url, 'tools/call', { name, arguments: args || {} }, connection.headers, fetchFn, 3, session);
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.map(part => part?.type === 'text' ? String(part.text) : JSON.stringify(part)).join('\n');
  return JSON.stringify({ isError: result.isError === true, content: text.slice(0, MAX_TOOL_OUTPUT) });
}

export function mcpToolDefinitions(connection) {
  return (connection?.tools || []).map(tool => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}
