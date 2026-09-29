import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { answerOperator, saveTavilyKey } from './operator.js';
import { seal, storedMcpConnection } from './mcp-oauth.js';

globalThis.crypto ||= webcrypto;

function database(row = null) {
  return {
    saved: null,
    prepare(sql) {
      return {
        bind: (...args) => ({
          first: async () => sql.includes('wa_mcp_connections') ? row : null,
          run: async () => { this.saved = args; return { meta: { changes: 1 } }; },
        }),
        first: async () => sql.includes('wa_mcp_connections') ? row : null,
      };
    },
  };
}

test('operator replies as a general assistant, without sales sanitization or WhatsApp', async () => {
  const env = { CATALOG_DB: database(), KIMI_API_KEY: 'test-key' };
  const result = await answerOperator(env, 'What is your role?', [], async (url, options) => {
    assert.equal(url, 'https://api.moonshot.ai/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content, /general-purpose assistant/);
    assert.doesNotMatch(body.messages[0].content, /warm member of the shop/);
    return Response.json({ choices: [{ message: { content: 'I can help research. See https://example.com.' } }] });
  });
  assert.equal(result.reply, 'I can help research. See https://example.com.');
  assert.deepEqual(result.tools, []);
});

test('operator reports model quota exhaustion clearly', async () => {
  const env = { CATALOG_DB: database(), KIMI_API_KEY: 'test-key' };
  await assert.rejects(() => answerOperator(env, 'Hello', [], async () =>
    Response.json({ error: { type: 'exceeded_current_quota_error' } }, { status: 429 })),
  /balance or quota is insufficient/);
});

test('operator routes a selected OpenRouter model through the same tool loop', async () => {
  const env = { CATALOG_DB: database(), OPENROUTER_API_KEY: 'test-openrouter-key' };
  let calls = 0;
  const result = await answerOperator(env, 'Read a page', [], async (url, options) => {
    if (url === 'https://example.com/') return new Response('<title>Example</title>', { headers: { 'content-type': 'text/html' } });
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer test-openrouter-key');
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'vendor/tool-model:free');
    assert.equal(request.thinking, undefined);
    calls++;
    if (calls === 1) return Response.json({ choices: [{ message: { content: null, tool_calls: [
      { id: 'open-url', type: 'function', function: { name: 'open_web_url', arguments: '{"url":"https://example.com/"}' } },
    ] } }] });
    assert.match(request.messages.at(-1).content, /Example/);
    return Response.json({ choices: [{ message: { content: 'Title: Example — https://example.com/' } }] });
  }, { provider: 'openrouter', model: 'vendor/tool-model:free', freeOnly: true });
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.model, 'vendor/tool-model:free');
  assert.deepEqual(result.tools, ['web:open_web_url']);
  assert.equal(calls, 2);
});

test('operator can open a public URL without Tavily and cite it', async () => {
  const env = { CATALOG_DB: database(), KIMI_API_KEY: 'test-key' };
  let modelCalls = 0;
  const result = await answerOperator(env, 'Read https://example.com/info', [], async (url, options) => {
    if (url === 'https://example.com/info') return new Response('<h1>Page title</h1>', { headers: { 'content-type': 'text/html' } });
    modelCalls++;
    const body = JSON.parse(options.body);
    if (modelCalls === 1) return Response.json({ choices: [{ message: { content: null, tool_calls: [
      { id: 'call-web', type: 'function', function: { name: 'open_web_url', arguments: '{"url":"https://example.com/info"}' } },
    ] } }] });
    assert.match(body.messages.at(-1).content, /Page title/);
    return Response.json({ choices: [{ message: { content: 'The page title is Page title: https://example.com/info' } }] });
  });
  assert.equal(result.reply, 'The page title is Page title: https://example.com/info');
  assert.deepEqual(result.tools, ['web:open_web_url']);
});

test('Tavily MCP tools are available in operator mode via bearer secret', async () => {
  const env = { CATALOG_DB: database(), KIMI_API_KEY: 'test-key', TAVILY_API_KEY: 'tvly-test-secret' };
  let modelCalls = 0;
  const result = await answerOperator(env, 'Search for current fabric trends', [], async (url, options) => {
    if (url.startsWith('https://mcp.tavily.com/')) {
      assert.equal(options.headers.authorization, 'Bearer tvly-test-secret');
      const body = JSON.parse(options.body);
      if (body.method === 'initialize') return Response.json({ result: {} });
      if (body.method === 'tools/list') return Response.json({ result: { tools: [
        { name: 'tavily-search', description: 'Search the web', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
      ] } });
      if (body.method === 'tools/call') {
        assert.equal(body.params.name, 'tavily-search');
        return Response.json({ result: { content: [{ type: 'text', text: 'Source: https://example.com/new' }] } });
      }
      return Response.json({});
    }
    modelCalls++;
    const body = JSON.parse(options.body);
    assert.equal(body.tools.length, 2);
    if (modelCalls === 1) return Response.json({ choices: [{ message: { content: null, tool_calls: [
      { id: 'call-1', type: 'function', function: { name: body.tools.find(tool => tool.function.name.startsWith('tavily_')).function.name, arguments: '{"query":"fabric trends"}' } },
    ] } }] });
    assert.match(body.messages.at(-1).content, /example.com\/new/);
    return Response.json({ choices: [{ message: { content: 'Latest source: https://example.com/new' } }] });
  });
  assert.equal(result.reply, 'Latest source: https://example.com/new');
  assert.deepEqual(result.tools, ['tavily:tavily-search']);
  assert.equal(result.tavilyAvailable, true);
  assert.equal(modelCalls, 2);
});

test('Tavily key is verified with MCP before encrypted storage', async () => {
  const db = database();
  const env = { CATALOG_DB: db, AGENT_ADMIN_KEY: 'test-admin-secret' };
  const tools = await saveTavilyKey(env, 'https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-valid-key-test', async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer tvly-valid-key-test');
    const method = JSON.parse(options.body).method;
    if (method === 'tools/list') return Response.json({ result: { tools: [{ name: 'tavily-search' }] } });
    return Response.json({ result: {} });
  });
  assert.deepEqual(tools, ['tavily-search']);
  assert.notEqual(db.saved[0], 'tvly-valid-key-test');
  await assert.rejects(() => saveTavilyKey(env, 'https://evil.example/mcp/?tavilyApiKey=tvly-valid-key-test'), /official Tavily MCP URL/);
});

test('expired Notion MCP token refreshes before use', async () => {
  const adminKey = 'test-admin-secret';
  const row = {
    server_url: 'https://mcp.notion.com/mcp', client_id: 'public-client', client_secret: await seal('', adminKey),
    access_token: await seal('expired-token', adminKey), refresh_token: await seal('refresh-token', adminKey),
    expires_at: 1, allowed_tools: '',
  };
  const db = database(row);
  const result = await storedMcpConnection({ CATALOG_DB: db, AGENT_ADMIN_KEY: adminKey }, async (url, options = {}) => {
    if (url.includes('oauth-protected-resource')) return Response.json({ authorization_servers: ['https://mcp.notion.com'] });
    if (url.includes('oauth-authorization-server')) return Response.json({ authorization_endpoint: 'https://mcp.notion.com/authorize', token_endpoint: 'https://mcp.notion.com/token' });
    assert.equal(url, 'https://mcp.notion.com/token');
    assert.equal(options.body.get('grant_type'), 'refresh_token');
    assert.equal(options.body.get('refresh_token'), 'refresh-token');
    return Response.json({ access_token: 'fresh-token', refresh_token: 'new-refresh-token', expires_in: 3600 });
  });
  assert.equal(result.token, 'fresh-token');
  assert.notEqual(db.saved[0], 'fresh-token');
});
