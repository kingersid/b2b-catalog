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

-- Migration for existing installs (2026-09-27): buyer-profile memory for the
-- general-agent persona. Run each line separately; duplicate-column errors are harmless.
-- ALTER TABLE wa_conversations ADD COLUMN customer_name TEXT;
-- ALTER TABLE wa_conversations ADD COLUMN city TEXT;
-- ALTER TABLE wa_conversations ADD COLUMN business_type TEXT;
-- ALTER TABLE wa_conversations ADD COLUMN use_case TEXT;
-- ALTER TABLE wa_conversations ADD COLUMN b2b TEXT NOT NULL DEFAULT 'unknown';
-- ALTER TABLE wa_conversations ADD COLUMN community_sent_at INTEGER;
