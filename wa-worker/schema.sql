-- Apply to the existing chandni-catalog D1 database before enabling this Worker.
CREATE TABLE IF NOT EXISTS wa_inbox (
  message_id TEXT PRIMARY KEY,
  wa_id TEXT NOT NULL,
  body TEXT NOT NULL,
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
  last_customer_at INTEGER NOT NULL
);
