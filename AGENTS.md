# AGENTS.md — Chandni Silk Mills Catalog

Project conventions and CI/CD pipeline info for AI agents working on this codebase.

## Project Overview

- **Stack**: Static HTML + Cloudflare Pages Functions + D1 (SQLite)
- **Repo**: https://github.com/kingersid/b2b-catalog
- **Live**: https://chandni-catalog.pages.dev
- **Account ID**: `e80e472d0cd0037855bc396a3b7f7d97`

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
| `index.html` | Main catalog (grid + detail slide views) |
| `admin.html` | Price admin — enter/edit ₹ prices per design |
| `price-catalog.html` | Price catalog — scrollable full-screen feed with prices |
| `dashboard.html` | Analytics dashboard (key-protected via `DASH_KEY` secret) |
| `media.js` | Shared file list (51 designs) used by admin + price-catalog |
| `functions/api/catalog.js` | Catalog API (visits, hearts, reach, CTA, sources) |
| `functions/prices.js` | Prices API (GET/POST for per-design ₹ prices) |
| `schema.sql` | D1 schema (visits, hearts, reach, cta, sources, prices tables) |
| `wrangler.toml` | Cloudflare Pages + D1 config |
| `scripts/check-portrait.mjs` | Deploy guard — rejects landscape images |

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
for tbl in visits hearts reach cta sources prices; do
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

## API Endpoints

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

### `/prices`

| Method | Body | Description |
|--------|------|-------------|
| GET | — | All prices `{prices: {itemId: price}}` |
| POST | `{itemId, price}` | Set/remove a price (null removes) |

## Conventions

- **Timezone**: All dates use `Asia/Kolkata` (IST)
- **Image paths**: Filenames are case-sensitive on Cloudflare Pages (`IMG_8327.webp` ≠ `img_8327.webp`)
- **No build step**: Static HTML served directly; no bundler or framework
- **CORS**: Functions allow any origin (catalog can be opened from `file://`)
- **Portrait only**: All images must be portrait (height ≥ width); enforced by `check-portrait.mjs`
- **Image optimization**: JPG originals + `mid/` (1000px webp) + `webp/` (1600px webp)

## Local Development

```bash
npx wrangler pages dev . --port 8788
```

- Site: http://localhost:8788
- D1 is local by default (empty SQLite under `.wrangler/`)
- Seed local D1: `npx wrangler d1 execute chandni-catalog --local --file=schema.sql`
- Use production data: add `--remote` flag
- Phone preview: `npx wrangler pages dev . --remote --ip 0.0.0.0`
