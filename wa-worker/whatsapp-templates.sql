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
