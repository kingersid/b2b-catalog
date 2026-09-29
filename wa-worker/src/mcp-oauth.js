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
  if (resource.href === 'https://mcp.sarvam.ai/voice-agents') {
    const metadata = await getJson('https://mcp.sarvam.ai/.well-known/oauth-authorization-server/voice-agents', fetchFn);
    return { authorizationEndpoint: metadata.authorization_endpoint, tokenEndpoint: metadata.token_endpoint,
      registrationEndpoint: metadata.registration_endpoint };
  }
  let protectedResource = null;
  try { protectedResource = await getJson(`${resource.origin}/.well-known/oauth-protected-resource`, fetchFn); } catch {}
  const issuer = protectedResource?.authorization_servers?.[0] || resource.origin;
  let metadata;
  try { metadata = await getJson(wellKnown(issuer, 'oauth-authorization-server'), fetchFn); }
  catch { metadata = await getJson(wellKnown(issuer, 'oauth-authorization-server'), fetchFn); }
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) throw new Error('OAuth metadata is missing authorization or token endpoint');
  return { authorizationEndpoint: metadata.authorization_endpoint, tokenEndpoint: metadata.token_endpoint,
    registrationEndpoint: metadata.registration_endpoint };
}

export async function beginMcpOAuth(env, request, input, fetchFn = fetch) {
  const serverUrl = String(input.serverUrl || '').trim();
  let clientId = String(input.clientId || '').trim();
  const clientSecret = String(input.clientSecret || '');
  const allowedTools = String(input.allowedTools || '').trim();
  if (!/^https:\/\//i.test(serverUrl)) throw new Error('MCP server URL must use HTTPS');
  const redirectUri = serverUrl === 'https://mcp.sarvam.ai/voice-agents' && input.redirectUri === 'http://127.0.0.1:17349/sarvam/callback'
    ? input.redirectUri : `${new URL(request.url).origin}/admin/mcp/oauth/callback`;
  const [pkce, metadata] = await Promise.all([pkcePair(), discoverOAuth(serverUrl, fetchFn)]);
  if (!clientId && serverUrl === 'https://mcp.sarvam.ai/voice-agents') {
    if (!metadata.registrationEndpoint) throw new Error('Sarvam OAuth client registration is unavailable');
    const registration = await fetchFn(metadata.registrationEndpoint, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_name: 'Chandni operator chat', redirect_uris: [redirectUri],
        grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
    const client = await registration.json().catch(() => ({}));
    if (!registration.ok || !client.client_id) {
      if (client.error === 'invalid_redirect_uri')
        throw new Error(`Sarvam must allow-list ${redirectUri} for MCP OAuth before this Worker can connect`);
      throw new Error(`Sarvam OAuth client registration failed: ${String(client.error || registration.status).slice(0, 80)}`);
    }
    clientId = client.client_id;
  }
  if (!clientId) throw new Error('OAuth client ID is required');
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
  if (pending.server_url === 'https://mcp.sarvam.ai/voice-agents') body.set('resource', pending.server_url);
  if (clientSecret) body.set('client_secret', clientSecret);
  const tokenResponse = await fetchFn(pending.token_endpoint, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description || `OAuth token HTTP ${tokenResponse.status}`);
  const now = Math.floor(Date.now() / 1000);
  const isSarvam = pending.server_url === 'https://mcp.sarvam.ai/voice-agents';
  const table = isSarvam ? 'wa_sarvam_mcp_connections' : 'wa_mcp_connections';
  await env.CATALOG_DB.prepare(`INSERT INTO ${table}
    (id, server_url, client_id, client_secret, access_token, refresh_token, token_type, expires_at, allowed_tools, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET server_url=excluded.server_url, client_id=excluded.client_id,
    client_secret=excluded.client_secret, access_token=excluded.access_token, refresh_token=excluded.refresh_token,
    token_type=excluded.token_type, expires_at=excluded.expires_at, allowed_tools=excluded.allowed_tools, updated_at=excluded.updated_at`)
    .bind(1, pending.server_url, pending.client_id, pending.client_secret, await seal(token.access_token, env.AGENT_ADMIN_KEY),
      token.refresh_token ? await seal(token.refresh_token, env.AGENT_ADMIN_KEY) : null, token.token_type || 'Bearer',
      token.expires_in ? now + Number(token.expires_in) : null, pending.allowed_tools || '', now).run();
  await env.CATALOG_DB.prepare('DELETE FROM wa_mcp_oauth_pending WHERE state = ?').bind(state).run();
  return pending.server_url;
}

export async function storedMcpConnection(env, fetchFn = fetch, connectionId = 1) {
  const table = connectionId === 2 ? 'wa_sarvam_mcp_connections' : 'wa_mcp_connections';
  const row = await env.CATALOG_DB.prepare(`SELECT * FROM ${table} WHERE id = 1`).first();
  if (!row) return null;
  let current = row;
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at && Number(row.expires_at) <= now + 90) {
    if (!row.refresh_token) throw new Error('Workspace MCP login expired; reconnect it in the admin inbox');
    const { tokenEndpoint } = await discoverOAuth(row.server_url, fetchFn);
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: await unseal(row.refresh_token, env.AGENT_ADMIN_KEY),
      client_id: row.client_id,
      resource: row.server_url,
    });
    const clientSecret = await unseal(row.client_secret, env.AGENT_ADMIN_KEY);
    if (clientSecret) body.set('client_secret', clientSecret);
    const result = await fetchFn(tokenEndpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const token = await result.json().catch(() => ({}));
    if (!result.ok || !token.access_token) {
      // A concurrent request may have rotated this one-time refresh token.
      const latest = await env.CATALOG_DB.prepare(`SELECT * FROM ${table} WHERE id = 1`).first();
      if (!latest || latest.access_token === row.access_token) throw new Error('Workspace MCP token refresh failed; reconnect it in the admin inbox');
      current = latest;
    } else {
      const accessToken = await seal(token.access_token, env.AGENT_ADMIN_KEY);
      const refreshToken = token.refresh_token ? await seal(token.refresh_token, env.AGENT_ADMIN_KEY) : row.refresh_token;
      const expiresAt = token.expires_in ? now + Number(token.expires_in) : null;
      const updated = await env.CATALOG_DB.prepare(`UPDATE ${table}
        SET access_token = ?, refresh_token = ?, token_type = ?, expires_at = ?, updated_at = ?
        WHERE id = 1 AND access_token = ?`)
        .bind(accessToken, refreshToken, token.token_type || 'Bearer', expiresAt, now, row.access_token).run();
      current = updated.meta?.changes
        ? { ...row, access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt }
        : await env.CATALOG_DB.prepare(`SELECT * FROM ${table} WHERE id = 1`).first();
    }
  }
  return { serverUrl: current.server_url, token: await unseal(current.access_token, env.AGENT_ADMIN_KEY), clientId: current.client_id, expiresAt: current.expires_at, allowedTools: current.allowed_tools || '' };
}
