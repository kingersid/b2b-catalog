const encoder = new TextEncoder();

function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytes(value) {
  const text = atob(String(value).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value).length / 4) * 4, '='));
  return Uint8Array.from(text, char => char.charCodeAt(0));
}

async function sha256(value) { return crypto.subtle.digest('SHA-256', encoder.encode(value)); }

export async function pkcePair() {
  const verifier = b64(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: b64(await sha256(verifier)) };
}

async function secretKey(secret, salt, usage) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, usage);
}

export async function seal(value, secret) {
  if (!secret) throw new Error('AGENT_ADMIN_KEY is required for OAuth token storage');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await secretKey(secret, salt, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(String(value)));
  return `${b64(salt)}.${b64(iv)}.${b64(ciphertext)}`;
}

export async function unseal(value, secret) {
  if (!value) return null;
  const [salt, iv, ciphertext] = String(value).split('.').map(bytes);
  const key = await secretKey(secret, salt, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plain);
}

async function getJson(url, fetchFn) {
  const result = await fetchFn(url, { headers: { accept: 'application/json' } });
  if (!result.ok) throw new Error(`OAuth discovery HTTP ${result.status}`);
  return result.json();
}

function wellKnown(issuer, suffix) {
  const url = new URL(issuer);
  return `${url.origin}/.well-known/${suffix}`;
}

export async function discoverOAuth(serverUrl, fetchFn = fetch) {
  const resource = new URL(serverUrl);
  let protectedResource = null;
  try { protectedResource = await getJson(`${resource.origin}/.well-known/oauth-protected-resource`, fetchFn); } catch {}
  const issuer = protectedResource?.authorization_servers?.[0] || resource.origin;
  let metadata;
  try { metadata = await getJson(wellKnown(issuer, 'oauth-authorization-server'), fetchFn); }
  catch { metadata = await getJson(wellKnown(issuer, 'oauth-authorization-server'), fetchFn); }
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) throw new Error('OAuth metadata is missing authorization or token endpoint');
  return { authorizationEndpoint: metadata.authorization_endpoint, tokenEndpoint: metadata.token_endpoint };
}

export async function beginMcpOAuth(env, request, input, fetchFn = fetch) {
  const serverUrl = String(input.serverUrl || '').trim();
  const clientId = String(input.clientId || '').trim();
  const clientSecret = String(input.clientSecret || '');
  const allowedTools = String(input.allowedTools || '').trim();
  if (!/^https:\/\//i.test(serverUrl)) throw new Error('MCP server URL must use HTTPS');
  if (!clientId) throw new Error('OAuth client ID is required');
  const redirectUri = `${new URL(request.url).origin}/admin/mcp/oauth/callback`;
  const [pkce, metadata] = await Promise.all([pkcePair(), discoverOAuth(serverUrl, fetchFn)]);
  const state = b64(crypto.getRandomValues(new Uint8Array(24)));
  await env.CATALOG_DB.prepare(`INSERT INTO wa_mcp_oauth_pending
    (state, server_url, client_id, client_secret, code_verifier, redirect_uri, authorization_endpoint, token_endpoint, allowed_tools, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(state, serverUrl, clientId, await seal(clientSecret, env.AGENT_ADMIN_KEY), pkce.verifier, redirectUri,
      metadata.authorizationEndpoint, metadata.tokenEndpoint, allowedTools,
      Math.floor(Date.now() / 1000)).run();
  const auth = new URL(metadata.authorizationEndpoint);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', redirectUri);
  auth.searchParams.set('state', state);
  auth.searchParams.set('code_challenge', pkce.challenge);
  auth.searchParams.set('code_challenge_method', 'S256');
  auth.searchParams.set('resource', serverUrl);
  return auth.toString();
}

export async function finishMcpOAuth(env, request, fetchFn = fetch) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  if (!state || !code) throw new Error(url.searchParams.get('error_description') || 'OAuth callback did not contain a code');
  const pending = await env.CATALOG_DB.prepare('SELECT * FROM wa_mcp_oauth_pending WHERE state = ?').bind(state).first();
  if (!pending || Number(pending.created_at) < Math.floor(Date.now() / 1000) - 600) throw new Error('OAuth state expired or was not found');
  const clientSecret = await unseal(pending.client_secret, env.AGENT_ADMIN_KEY);
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: pending.client_id,
    redirect_uri: pending.redirect_uri, code_verifier: pending.code_verifier });
  if (clientSecret) body.set('client_secret', clientSecret);
  const tokenResponse = await fetchFn(pending.token_endpoint, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description || `OAuth token HTTP ${tokenResponse.status}`);
  const now = Math.floor(Date.now() / 1000);
  await env.CATALOG_DB.prepare(`INSERT INTO wa_mcp_connections
    (id, server_url, client_id, client_secret, access_token, refresh_token, token_type, expires_at, allowed_tools, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET server_url=excluded.server_url, client_id=excluded.client_id,
    client_secret=excluded.client_secret, access_token=excluded.access_token, refresh_token=excluded.refresh_token,
    token_type=excluded.token_type, expires_at=excluded.expires_at, allowed_tools=excluded.allowed_tools, updated_at=excluded.updated_at`)
    .bind(pending.server_url, pending.client_id, pending.client_secret, await seal(token.access_token, env.AGENT_ADMIN_KEY),
      token.refresh_token ? await seal(token.refresh_token, env.AGENT_ADMIN_KEY) : null, token.token_type || 'Bearer',
      token.expires_in ? now + Number(token.expires_in) : null, pending.allowed_tools || '', now).run();
  await env.CATALOG_DB.prepare('DELETE FROM wa_mcp_oauth_pending WHERE state = ?').bind(state).run();
  return pending.server_url;
}

export async function storedMcpConnection(env) {
  const row = await env.CATALOG_DB.prepare('SELECT * FROM wa_mcp_connections WHERE id = 1').first();
  if (!row) return null;
  return { serverUrl: row.server_url, token: await unseal(row.access_token, env.AGENT_ADMIN_KEY), clientId: row.client_id, expiresAt: row.expires_at, allowedTools: row.allowed_tools || '' };
}
