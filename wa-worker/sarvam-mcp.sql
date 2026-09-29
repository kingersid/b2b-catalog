CREATE TABLE IF NOT EXISTS wa_sarvam_mcp_connections (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  server_url TEXT NOT NULL, client_id TEXT NOT NULL, client_secret TEXT,
  access_token TEXT NOT NULL, refresh_token TEXT,
  token_type TEXT NOT NULL DEFAULT 'Bearer', expires_at INTEGER,
  allowed_tools TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_operator_sarvam_actions (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','unknown')),
  result_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_operator_sarvam_session ON wa_operator_sarvam_actions(session_id, created_at);
