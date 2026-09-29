import test from 'node:test';
import assert from 'node:assert/strict';
import { beginMcpOAuth, discoverOAuth } from './mcp-oauth.js';

test('Sarvam MCP uses path-scoped OAuth metadata and dynamic client registration', async () => {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/.well-known/oauth-authorization-server/voice-agents')) return Response.json({
      authorization_endpoint: 'https://mcp.sarvam.ai/voice-agents/authorize',
      token_endpoint: 'https://mcp.sarvam.ai/voice-agents/token',
      registration_endpoint: 'https://mcp.sarvam.ai/voice-agents/register',
    });
    if (url.endsWith('/register')) return Response.json({ client_id: 'registered-client' });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const meta = await discoverOAuth('https://mcp.sarvam.ai/voice-agents', fetchFn);
  assert.match(meta.registrationEndpoint, /voice-agents\/register$/);
  const saved = [];
  const env = { AGENT_ADMIN_KEY: 'test-admin-secret', CATALOG_DB: { prepare(sql) {
    assert.match(sql, /wa_mcp_oauth_pending/);
    return { bind(...values) { saved.push(values); return { run: async () => ({}) }; } };
  } } };
  const url = await beginMcpOAuth(env, new Request('https://worker.example/admin/operator/sarvam/oauth/start'),
    { serverUrl: 'https://mcp.sarvam.ai/voice-agents' }, fetchFn);
  assert.equal(new URL(url).searchParams.get('client_id'), 'registered-client');
  assert.equal(new URL(url).searchParams.get('resource'), 'https://mcp.sarvam.ai/voice-agents');
  assert.equal(saved[0][2], 'registered-client');
  assert.equal(calls.filter(call => call.url.endsWith('/register')).length, 1);
});
