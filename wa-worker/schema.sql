-- Apply to the existing chandni-catalog D1 database before enabling this Worker.
-- For databases created before 2026-09-27, also run the ALTER TABLE statements at the
-- bottom (they are safe to re-run; ignore 'duplicate column name' errors).
CREATE TABLE IF NOT EXISTS wa_inbox (
  message_id TEXT PRIMARY KEY,
  wa_id TEXT NOT NULL,
  body TEXT NOT NULL,
  media_kind TEXT,
  media_id TEXT,
  media_mime TEXT,
  interpreted_text TEXT,
  received_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  reply_text TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_wa_inbox_due ON wa_inbox(status, available_at, lease_until);
CREATE INDEX IF NOT EXISTS idx_wa_inbox_history ON wa_inbox(wa_id, received_at);

CREATE TABLE IF NOT EXISTS wa_conversations (
  wa_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'bot',
  updated_at INTEGER NOT NULL,
  last_customer_at INTEGER NOT NULL,
  customer_name TEXT,
  city TEXT,
  business_type TEXT,
  use_case TEXT,
  b2b TEXT NOT NULL DEFAULT 'unknown',
  community_sent_at INTEGER
);

CREATE TABLE IF NOT EXISTS wa_mcp_oauth_pending (
  state TEXT PRIMARY KEY,
  server_url TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  authorization_endpoint TEXT NOT NULL,
  token_endpoint TEXT NOT NULL,
  allowed_tools TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_mcp_connections (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  server_url TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  expires_at INTEGER,
  allowed_tools TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_operator_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_operator_chat_session ON wa_operator_chat_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS wa_operator_whatsapp_drafts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  to_wa_id TEXT NOT NULL,
  template_name TEXT NOT NULL,
  language TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  preview TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'unknown')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  graph_message_id TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_wa_operator_whatsapp_drafts_session ON wa_operator_whatsapp_drafts(session_id, status, created_at);

-- Tavily MCP is private to the operator chat. The API key is sealed with the
-- Worker admin secret before storage; it is never returned by an endpoint.
CREATE TABLE IF NOT EXISTS wa_operator_tavily (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  api_key TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- OpenRouter inference is private to operator chat; the key is sealed with
-- AGENT_ADMIN_KEY before storage and is never included in API responses.
CREATE TABLE IF NOT EXISTS wa_operator_openrouter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  api_key TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_sarvam_mcp_connections (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  server_url TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  expires_at INTEGER,
  allowed_tools TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_operator_sarvam_actions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','unknown')),
  result_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_operator_sarvam_rest (id INTEGER PRIMARY KEY CHECK(id=1), api_key TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS wa_operator_sarvam_rest_actions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, arguments_json TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_wa_operator_sarvam_session ON wa_operator_sarvam_actions(session_id, created_at);

-- Migration for existing installs (2026-09-27): buyer-profile memory for the
-- general-agent persona. Run each line separately; duplicate-column errors are harmless.
-- ALTER TABLE wa_conversations ADD COLUMN customer_name TEXT;
-- ALTER TABLE wa_conversations ADD COLUMN city TEXT;
-- ALTER TABLE wa_conversations ADD COLUMN business_type TEXT;
-- ALTER TABLE wa_conversations ADD COLUMN use_case TEXT;
-- ALTER TABLE wa_conversations ADD COLUMN b2b TEXT NOT NULL DEFAULT 'unknown';
-- ALTER TABLE wa_conversations ADD COLUMN community_sent_at INTEGER;
