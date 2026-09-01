-- Chandni Silk Mills catalog — D1 schema (apply once: wrangler d1 execute <db> --remote --file=schema.sql)
-- Replace the old Netlify Blobs store ("catalog-data").

CREATE TABLE IF NOT EXISTS visits (
  day   TEXT PRIMARY KEY,  -- "YYYY-MM-DD" (Asia/Kolkata)
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hearts (
  item_id TEXT PRIMARY KEY,
  count   INTEGER NOT NULL DEFAULT 0
);

-- Scroll-depth funnel: how deep visitors scroll through the feed.
-- One row per (day, depth); depth 1 = first product image.
-- count = number of sessions that reached AT LEAST that depth.
CREATE TABLE IF NOT EXISTS reach (
  day   TEXT NOT NULL,            -- "YYYY-MM-DD" (Asia/Kolkata)
  depth INTEGER NOT NULL,         -- 1 = first product image
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, depth)
);

-- Per-design WhatsApp CTA clicks (the main conversion signal).
CREATE TABLE IF NOT EXISTS cta (
  item_id TEXT PRIMARY KEY,
  count   INTEGER NOT NULL DEFAULT 0
);

-- Day-wise CTA events for trend analysis.
-- Each row = one CTA click on a given design on a given day (Asia/Kolkata).
CREATE TABLE IF NOT EXISTS cta_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  day     TEXT NOT NULL,           -- "YYYY-MM-DD" (Asia/Kolkata)
  item_id TEXT NOT NULL,           -- design id or special label like "landing"
  ts      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cta_events_day ON cta_events(day);
CREATE INDEX IF NOT EXISTS idx_cta_events_item_day ON cta_events(item_id, day);

-- Visit traffic sources (utm/src param > referrer > "direct"), so day-to-day
-- swings in visits are explainable. One row per (day, source).
CREATE TABLE IF NOT EXISTS sources (
  day    TEXT NOT NULL,           -- "YYYY-MM-DD" (Asia/Kolkata)
  source TEXT NOT NULL,           -- e.g. "instagram", "web.whatsapp.com", "direct"
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source)
);

-- Per-design prices (₹). Used by the price catalog and admin pages.
CREATE TABLE IF NOT EXISTS prices (
  item_id TEXT PRIMARY KEY,
  price   INTEGER NOT NULL         -- price in whole rupees
);

-- Catalog design list — rows instead of hard-coded FILES arrays in index.html/media.js.
-- R2 holds the images; D1 holds the metadata + display order.
CREATE TABLE IF NOT EXISTS designs (
  design_id   TEXT PRIMARY KEY,          -- filename stem, e.g. "img_8327" or uuid
  name        TEXT NOT NULL DEFAULT '',  -- display label; falls back to design_id
  sort_order  INTEGER NOT NULL DEFAULT 0,-- grid order (0 first)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  active      INTEGER NOT NULL DEFAULT 1  -- 0 = hidden (soft delete)
);
