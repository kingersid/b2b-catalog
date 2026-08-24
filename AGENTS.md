# AGENTS.md — Chandni Silk Mills Catalog

Project conventions and CI/CD pipeline info for AI agents working on this codebase.

## Project Overview

- **Stack**: Static HTML + Cloudflare Pages Functions + D1 (SQLite) + R2 (object storage)
- **Repo**: https://github.com/kingersid/b2b-catalog
- **Live**: https://chandni-catalog.pages.dev
- **Account ID**: `e80e472d0cd0037855bc396a3b7f7d97`

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Static HTML (index.html, admin.html, etc.)         │
│  No build step — served directly by Pages           │
└──────────────┬──────────────────────┬───────────────┘
               │                      │
       ┌───────▼────────┐    ┌───────▼────────┐
       │  D1 (SQLite)   │    │  R2 (Objects)  │
       │  CATALOG_DB    │    │  DESIGNS_BUCKET│
       │                │    │                │
       │ • visits       │    │ • images       │
       │ • hearts       │    │   (original/   │
       │ • reach        │    │    mid/        │
       │ • cta          │    │    webp/)      │
       │ • sources      │    └────────────────┘
       │ • prices       │
       │ • designs      │
       └────────────────┘
```

### D1 (Database)

- **Binding**: `CATALOG_DB`
- **Database**: `chandni-catalog` (ID: `c1978fb2-5f08-48f9-94b9-58d6bdfc1628`)
- **Tables**: visits, hearts, reach, cta, sources, prices, designs

### R2 (Object Storage)

- **Binding**: `DESIGNS_BUCKET`
- **Bucket**: `chandni-catalog-assets`
- **Key structure**: `designs/original/{id}.jpg`, `designs/mid/{id}.webp`, `designs/webp/{id}.webp`
- **Access**: Proxied via `/api/designs?img=<key>` (not direct R2 URLs)

## CI/CD Pipeline

**GitHub Actions → Cloudflare Pages (auto-deploy)**

- **Trigger**: Push to `main` branch
- **Workflow**: `.github/workflows/deploy.yml`
- **Action**: `cloudflare/wrangler-action@v3`
- **Deploy target**: `chandni-catalog` Pages project
- **Build step**: None (static site, no build)
- **Output dir**: `.` (project root)

### Required GitHub Secrets

| Secret | Value |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with `Pages:Edit` permission |
| `CLOUDFLARE_ACCOUNT_ID` | `e80e472d0cd0037855bc396a3b7f7d97` |

### Deploy Workflow

```bash
# Standard workflow (both PCs)
git pull
# ... make changes ...
git add -A && git commit -m "description"
git push   # auto-deploys via GitHub Actions

# Manual deploy (bypass CI)
npm run deploy   # runs portrait check + wrangler pages deploy
```

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Main catalog — grid + detail slide views; fetches designs from D1 API |
| `admin.html` | Price admin — enter/edit ₹ prices per design |
| `price-catalog.html` | Price catalog — scrollable full-screen feed with prices |
| `dashboard.html` | Analytics dashboard (key-protected via `DASH_KEY` secret) |
| `functions/api/catalog.js` | Catalog API (visits, hearts, reach, CTA, sources) — D1-backed |
| `functions/api/designs.js` | Designs API (list from D1, image proxy from R2) |
| `functions/api/upload.js` | Upload endpoint (multipart → R2 + D1 row) |
| `functions/prices.js` | Prices API (GET/POST for per-design ₹ prices) — D1-backed |
| `functions/share.js` | Share page — server-rendered OG tags, fetches design list from D1 |
| `schema.sql` | D1 schema (all 7 tables) |
| `wrangler.toml` | Cloudflare Pages + D1 + R2 config |
| `scripts/check-portrait.mjs` | Deploy guard — rejects landscape images |
| `scripts/upload-r2.mjs` | Bulk upload images to R2 via wrangler CLI |
| `scripts/seed-designs.sh` | Seed existing images into R2 + D1 |
| `scripts/add-from-gphotos.mjs` | Import images from Google Photos share links |

## D1 Database

**Binding**: `CATALOG_DB` (defined in `wrangler.toml`)
**Database**: `chandni-catalog` (ID: `c1978fb2-5f08-48f9-94b9-58d6bdfc1628`)

### Tables

| Table | Purpose |
|-------|---------|
| `visits` | Daily visit counts (Asia/Kolkata timezone) |
| `hearts` | Per-design heart/like counts |
| `reach` | Design view tracking (which designs are opened full-screen) |
| `cta` | Per-design WhatsApp CTA click counts |
| `sources` | Traffic sources per day (utm/referrer/direct) |
| `prices` | Per-design prices in ₹ |
| `designs` | Design metadata + sort order (R2 holds the images) |

### Common Commands

```bash
# Apply schema to remote
npx wrangler d1 execute chandni-catalog --remote --file=schema.sql

# Apply schema to local
npx wrangler d1 execute chandni-catalog --local --file=schema.sql

# Query remote data
npx wrangler d1 execute chandni-catalog --remote --command "SELECT * FROM prices;"

# Export remote database
npx wrangler d1 export chandni-catalog --remote --output backup.sql
```

### Source of Truth

**Production D1 is the source of truth.** Local D1 is a per-machine SQLite file
under `.wrangler/` — not shared, and wiped if `.wrangler/` is deleted.

| | Local D1 | Production D1 |
|--|----------|---------------|
| Location | `.wrangler/state/v3/d1/` on each PC | Cloudflare edge |
| Data | Copy/snapshot | Real user data |
| Who uses it | `wrangler pages dev` only | Live site visitors |
| Shared? | No — each PC has its own | Yes — single instance |

### Syncing Local from Production

Run this whenever local data is stale (e.g. after other PC made changes,
or after testing on production):

```bash
# 1. Export production data (creates a full SQL dump)
npx wrangler d1 export chandni-catalog --remote --output prod-sync.sql

# 2. Strip CREATE TABLE statements (keep only INSERTs)
grep '^INSERT' prod-sync.sql > prod-inserts.sql

# 3. Apply schema to local (creates tables if missing)
npx wrangler d1 execute chandni-catalog --local --file=schema.sql

# 4. Import production data into local
npx wrangler d1 execute chandni-catalog --local --file=prod-inserts.sql

# 5. Clean up
rm prod-sync.sql prod-inserts.sql
```

Or use the one-liner:

```bash
npx wrangler d1 export chandni-catalog --remote --output /tmp/prod.sql && \
grep '^INSERT' /tmp/prod.sql > /tmp/ins.sql && \
npx wrangler d1 execute chandni-catalog --local --file=schema.sql && \
npx wrangler d1 execute chandni-catalog --local --file=/tmp/ins.sql && \
echo "Sync complete"
```

### Checking for Discrepancies

```bash
# Compare row counts between local and production
for tbl in visits hearts reach cta sources prices designs; do
  prod=$(npx wrangler d1 execute chandni-catalog --remote \
    --command "SELECT COUNT(*) as cnt FROM $tbl;" 2>&1 | \
    grep '"cnt":' | grep -o '[0-9]*')
  local=$(npx wrangler d1 execute chandni-catalog --local \
    --command "SELECT COUNT(*) as cnt FROM $tbl;" 2>&1 | \
    grep '"cnt":' | grep -o '[0-9]*')
  if [ "$prod" = "$local" ]; then
    echo "✅ $tbl: $prod rows"
  else
    echo "⚠️  $tbl: prod=$prod local=$local"
  fi
done
```

**Rule**: always make changes via the live site's admin pages. Don't edit local
D1 directly — those changes are lost on the next prod sync.

## R2 Object Storage

**Binding**: `DESIGNS_BUCKET` (defined in `wrangler.toml`)
**Bucket**: `chandni-catalog-assets`

### Key Structure

```
designs/
  original/{id}.jpg    — full-resolution original
  mid/{id}.webp        — 1000px, q72 (~200KB avg)
  webp/{id}.webp       — 1600px, q75 (~450KB avg)
```

Images are **never accessed directly from R2** — they're proxied through
`/api/designs?img=<key>` which sets proper CORS and cache headers.

### Common Commands

```bash
# Upload a single image to R2
npx wrangler r2 object put chandni-catalog-assets/designs/original/abc123.jpg \
  --file=abc123.jpg --content-type=image/jpeg --remote

# List all objects in R2
node scripts/list-r2.mjs

# Bulk upload all root JPGs to R2 + D1
bash scripts/seed-designs.sh
```

## API Endpoints

### `/api/designs`

| Method | Params | Description |
|--------|--------|-------------|
| GET | — | All active designs from D1 (id, name, sort_order) |
| GET | `?format=files` | Legacy compat: `{files: ["id.jpg", ...]}` |
| GET | `?format=full` | Include resolved image URLs for each design |
| GET | `?img=designs/original/{id}.jpg` | Image proxy — serves raw bytes from R2 with immutable caching |

### `/api/catalog`

| Method | Action | Body | Description |
|--------|--------|------|-------------|
| GET | (default) | — | Today's visit count |
| GET | `hearts` | — | All heart counts |
| GET | `reach` | `?key=...` | Dashboard analytics (key-protected) |
| POST | `addVisit` | `{source}` | Record a visit |
| POST | `heart` | `{itemId, delta}` | Like/unlike a design |
| POST | `ctaClick` | `{itemId}` | Record WhatsApp CTA click |
| POST | `reach` | `{depth}` | Record design view |

### `/api/upload`

| Method | Body | Description |
|--------|------|-------------|
| POST | `multipart/form-data` | Upload image: `key` (secret) + `design` (file) → R2 + D1 |

Requires `UPLOAD_KEY` secret: `npx wrangler pages secret put UPLOAD_KEY`

### `/prices`

| Method | Body | Description |
|--------|------|-------------|
| GET | — | All prices `{prices: {itemId: price}}` |
| POST | `{itemId, price}` | Set/remove a price (null removes) |

### `/share`

| Method | Params | Description |
|--------|--------|-------------|
| GET | `?id=<design_id>` or `?index=N` | Server-rendered share page with OG tags (fetches design list from D1) |

## Adding a New Design

### Via iPhone Upload (preferred)

1. Open the upload page on your phone
2. Select a photo → it's auto-optimized and uploaded to R2 + D1
3. The design appears in the catalog immediately

### Via Google Photos

```bash
node scripts/add-from-gphotos.mjs <google-photos-link> [--single]
```

Downloads, optimizes (mid/webp), verifies portrait, and adds to FILES arrays.

### Manual

1. Drop the photo into the project root as `something.jpg`
2. Generate optimized versions:
   ```bash
   magick something.jpg -auto-orient -resize 1000x1000 -quality 72 mid/something.webp
   magick something.jpg -auto-orient -resize 1600x1600 -quality 75 webp/something.webp
   ```
3. Upload to R2:
   ```bash
   npx wrangler r2 object put chandni-catalog-assets/designs/original/something.jpg \
     --file=something.jpg --content-type=image/jpeg --remote
   ```
4. Insert into D1:
   ```bash
   npx wrangler d1 execute chandni-catalog --remote --command \
     "INSERT INTO designs (design_id, name, sort_order) VALUES ('something', 'something.jpg', (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM designs));"
   ```
5. Redeploy: `npm run deploy`

## Conventions

- **Timezone**: All dates use `Asia/Kolkata` (IST)
- **Image paths**: Filenames are case-sensitive on Cloudflare Pages (`IMG_8327.webp` ≠ `img_8327.webp`)
- **No build step**: Static HTML served directly; no bundler or framework
- **CORS**: Functions allow any origin (catalog can be opened from `file://`)
- **Portrait only**: All images must be portrait (height ≥ width); enforced by `check-portrait.mjs`
- **Image optimization**: JPG originals + `mid/` (1000px webp) + `webp/` (1600px webp)
- **Image serving**: R2 images proxied via `/api/designs?img=` — never direct R2 URLs
- **Design list**: Fetches from D1 at runtime — no more hardcoded FILES arrays in HTML

## Local Development

```bash
npx wrangler pages dev . --port 8788
```

- Site: http://localhost:8788
- D1 is local by default (empty SQLite under `.wrangler/`)
- Seed local D1: `npx wrangler d1 execute chandni-catalog --local --file=schema.sql`
- Use production data: add `--remote` flag
- Phone preview: `npx wrangler pages dev . --remote --ip 0.0.0.0`
