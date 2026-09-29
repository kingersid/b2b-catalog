CREATE TABLE IF NOT EXISTS wa_operator_sarvam_rest (id INTEGER PRIMARY KEY CHECK(id=1), api_key TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS wa_operator_sarvam_rest_actions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, arguments_json TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
