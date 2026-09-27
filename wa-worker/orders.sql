-- Order inbox for messages sent by the catalog WhatsApp Business App number.
CREATE TABLE IF NOT EXISTS wa_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_message_id TEXT,
  sender TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  party TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  capture_until INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wa_orders_pending ON wa_orders(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_orders_start_message ON wa_orders(start_message_id);
CREATE TABLE IF NOT EXISTS wa_order_items (
  message_id TEXT PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES wa_orders(id),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
  text TEXT,
  r2_key TEXT,
  mime TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_order_items_order ON wa_order_items(order_id, created_at);
CREATE TABLE IF NOT EXISTS wa_order_context (
  message_id TEXT PRIMARY KEY,
  replied_to_message_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_order_reminders (
  day TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  sent_at INTEGER,
  graph_message_id TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS wa_order_outbound (
  graph_message_id TEXT PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES wa_orders(id),
  sent_at INTEGER NOT NULL
);
