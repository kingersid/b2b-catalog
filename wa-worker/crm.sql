CREATE TABLE IF NOT EXISTS wa_crm_config (id INTEGER PRIMARY KEY CHECK(id=1), api_key TEXT NOT NULL, database_id TEXT, data_source_id TEXT, parent_id TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS wa_crm_orders (
 order_id INTEGER PRIMARY KEY REFERENCES wa_orders(id), customer_name TEXT, phone TEXT, products TEXT,
 payment_status TEXT NOT NULL DEFAULT 'Unknown', dispatch_status TEXT NOT NULL DEFAULT 'Not ready',
 order_status TEXT NOT NULL DEFAULT 'New', amount_due REAL, next_action TEXT, last_contact TEXT,
 confidence TEXT NOT NULL DEFAULT 'needs_review', notion_page_id TEXT, synced_at INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 1, sync_revision INTEGER NOT NULL DEFAULT 0, sync_lease INTEGER NOT NULL DEFAULT 0, sync_error TEXT
);
CREATE TABLE IF NOT EXISTS wa_crm_actions (
 id TEXT PRIMARY KEY, order_id INTEGER NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL, preview TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', revision INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 linked_draft_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(order_id,kind,revision)
);
CREATE TABLE IF NOT EXISTS wa_crm_events (id TEXT PRIMARY KEY, order_id INTEGER NOT NULL, channel TEXT NOT NULL, outcome TEXT NOT NULL, details TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS wa_crm_digest (day TEXT PRIMARY KEY, status TEXT NOT NULL, summary TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS wa_terminal_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, runtime TEXT NOT NULL, code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', stdout TEXT, stderr TEXT, exit_code INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_terminal_one_running ON wa_terminal_runs(status) WHERE status='running';
CREATE TABLE IF NOT EXISTS wa_crm_views (name TEXT PRIMARY KEY, status TEXT NOT NULL, view_id TEXT);
CREATE TABLE IF NOT EXISTS wa_crm_remote_state (order_id INTEGER PRIMARY KEY, properties_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
