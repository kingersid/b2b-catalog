-- Apply once to the existing production D1 before deploying metadata-aware code.
CREATE TABLE IF NOT EXISTS design_metadata (
  design_id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  fabric_type TEXT NOT NULL DEFAULT '',
  pattern TEXT NOT NULL DEFAULT '',
  colors TEXT NOT NULL DEFAULT '',
  use_cases TEXT NOT NULL DEFAULT '',
  composition TEXT NOT NULL DEFAULT '',
  width_cm REAL,
  moq_meters REAL,
  availability TEXT NOT NULL DEFAULT 'unknown'
    CHECK (availability IN ('unknown', 'available', 'low_stock', 'sold_out')),
  keywords TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
