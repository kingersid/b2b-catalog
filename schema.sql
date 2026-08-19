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
