# Chandni Silk Mills — Catalog (Cloudflare Pages + D1 + R2)

Migrated from the Netlify Drop app (`Photos-1-001`) to **Cloudflare Pages + D1 + R2** because
Netlify's free tier (100 GB/month bandwidth) was exhausted. Cloudflare Pages has
**unlimited bandwidth**, 500 builds/month, and 100k free function requests/day.

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

- **D1** stores all structured data: visit counts, hearts, design views, CTA clicks,
  traffic sources, prices, and the design list (no more hardcoded `FILES` arrays).
- **R2** stores all images: originals + optimized variants, served to the browser via
  a Pages Function image proxy (`/api/designs?img=`).

## What changed vs. the Netlify version

- **All videos removed** — the feed is images only.
- **Images optimized**: each JPG has a `mid/` (1000px, q72, ~200KB avg) and `webp/`
  (1600px, q75, ~450KB avg) WebP sibling. The feed loads `mid/` first, upgrades to
  the active slide, and falls back to the original JPG only if WebP is unavailable.
- **Images moved to R2**: no more static files in `mid/` and `webp/` subdirectories.
  Images are stored in Cloudflare R2 and proxied through `/api/designs?img=`.
- **Design list from D1**: the `designs` table replaces hardcoded `FILES` arrays.
  The catalog fetches its design list from `/api/designs` at runtime.
- **Upload endpoint**: `POST /api/upload` accepts multipart images, stores to R2,
  and inserts a row into D1 — live in the catalog in ~1 second.
- **Backend**: Netlify functions + Netlify Blobs →
  Cloudflare Pages Functions + **D1** (SQLite) + **R2** (object storage).
- **Landing poster**: since 2026-08-17 it's the **closing poster card** after the
  last design, not the entry gate.
- **Grid → detail UX**: the catalog lands on a 3-column grid of all designs; tapping
  one opens the full-screen slide view, with a closing poster card after the last design.
- **Performance**: Lighthouse mobile (throttled 4G): performance 99/100, LCP 1.3s,
  CLS 0, total transferred bytes 2.5MB for a full scroll-through.

## CI/CD Pipeline (GitHub Actions → Cloudflare Pages)

Deploys are fully automated via GitHub Actions. Every push to `main` triggers a
deploy to Cloudflare Pages production.

### How it works

1. Push to `main` → GitHub Actions runs `.github/workflows/deploy.yml`
2. Workflow uses `cloudflare/wrangler-action` to deploy to Pages
3. Site goes live at `https://chandni-catalog.pages.dev` (usually within ~30s)

### Setup (one-time)

1. **Create a Cloudflare API token** at https://dash.cloudflare.com/profile/api-tokens
   - Use the **"Edit Cloudflare Workers"** template (includes `Pages:Edit` permission)
2. **Add GitHub secrets** at https://github.com/kingersid/b2b-catalog/settings/secrets/actions
   - `CLOUDFLARE_API_TOKEN` → your API token
   - `CLOUDFLARE_ACCOUNT_ID` → `e80e472d0cd0037855bc396a3b7f7d97`
3. **Connect Cloudflare Pages** to the GitHub repo:
   - Cloudflare Dashboard → Workers & Pages → chandni-catalog → Settings → Builds & deployments → Connect to Git

### Day-to-day workflow

```bash
# Both PCs: pull, make changes, push
git pull
# ... edit files ...
git add -A && git commit -m "description of change"
git push    # auto-deploys to production
```

### Manual deploy (bypass CI)

```bash
npm run deploy   # runs portrait check + wrangler pages deploy
```

### Preview deployments

Pull requests automatically get a preview URL (e.g. `https://abc123.chandni-catalog.pages.dev`)
so you can test changes before merging to `main`.

## Local development

Run the site locally (static files + all API functions + D1 + R2 bindings):

```bash
npx wrangler pages dev . --port 8788
```

- Open **http://localhost:8788** — this is the full mobile feed.
- Every request to `/api/catalog?action=...` logs to that terminal; `Ctrl+C` stops it.

**D1 data in local dev**

- By default `pages dev` uses a **local** D1 (an empty SQLite file under `.wrangler/`),
  so the API works but shows 0s until you seed it:
  `npx wrangler d1 execute chandni-catalog --local --file=schema.sql`
- To use the **real production data** instead, add `--remote`:
  `npx wrangler pages dev . --port 8788 --remote`

**R2 in local dev**

- Local R2 data is stored under `.wrangler/` — images uploaded locally won't affect production.
- Use `--remote` to proxy images from the production R2 bucket.

**Secrets** — `DASH_KEY` and `UPLOAD_KEY` are Pages secrets, which local dev doesn't have;
the `/dashboard` page will show "dashboard key not configured" unless you add a fallback
or hit the deployed site instead.

**Preview on your phone** (this is a mobile-first feed — worth checking on a real
phone, same Wi-Fi):

```bash
npx wrangler pages dev . --remote --ip 0.0.0.0
# then open http://<your-computer-LAN-IP>:8788 on the phone
```

**Smoke test the API** (in a second terminal while the server runs):

```bash
curl http://localhost:8788/                        # the feed HTML
curl http://localhost:8788/api/designs             # design list from D1
curl http://localhost:8788/api/catalog             # { today, count } site visits
curl http://localhost:8788/api/catalog?action=hearts   # hearts JSON
```

Note: opening `index.html` directly from the filesystem (`file://`) also works for a
quick look at the feed — the frontend detects it and serves engagement requests from
the deployed backend — but the local server above is the full dev experience.

## Adding a new design

### Via iPhone Upload (preferred)

1. Open the upload page on your phone
2. Select a photo → it's auto-optimized and uploaded to R2 + D1
3. The design appears in the catalog immediately

### Via Google Photos

```bash
node scripts/add-from-gphotos.mjs <google-photos-link> [--single]
```

Downloads, optimizes (mid/webp), verifies portrait, and adds to the catalog.

### Manual

1. Drop the photo into this folder as `something.jpg`.
2. Generate the optimized siblings. **Photos must be portrait** (height ≥ width):
   ```bash
   magick something.jpg -auto-orient -resize 1000x1000 -quality 72 mid/something.webp
   magick something.jpg -auto-orient -resize 1600x1600 -quality 75 webp/something.webp
   ```
   Then rotate the source itself so the fallback JPG is upright too:
   `magick mogrify -auto-orient -quality 95 something.jpg`
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

### Bulk seed (one-time migration)

```bash
bash scripts/seed-designs.sh   # uploads all root JPGs to R2 + inserts into D1
```

## R2 Object Storage

**Bucket**: `chandni-catalog-assets`
**Binding**: `DESIGNS_BUCKET`

### Key Structure

```
designs/
  original/{id}.jpg    — full-resolution original
  mid/{id}.webp        — 1000px, q72 (~200KB avg)
  webp/{id}.webp       — 1600px, q75 (~450KB avg)
```

Images are **never accessed directly from R2** — they're proxied through
`/api/designs?img=<key>` which sets proper CORS and immutable cache headers.

### Common Commands

```bash
# Upload a single image
npx wrangler r2 object put chandni-catalog-assets/designs/original/abc123.jpg \
  --file=abc123.jpg --content-type=image/jpeg --remote

# List all objects in R2
node scripts/list-r2.mjs

# Bulk upload all root JPGs to R2 + D1
bash scripts/seed-designs.sh
```

## Portrait-mode guard (enforced, no exceptions)

Every image in the project must display in portrait (height ≥ width). A deploy-time
check (`scripts/check-portrait.mjs`, run automatically by `npm run deploy`) scans
all images and aborts the deploy if any is landscape or would render sideways via an
EXIF rotation flag.

```bash
npm run check:portrait   # standalone: exit 0 = all portrait, 1 = abort
```

## Pages

| URL | Description |
|-----|-------------|
| `/` | Main catalog — grid view, tap to open full-screen |
| `/admin` | Price admin — enter/edit ₹ prices per design |
| `/price-catalog` | Price catalog — scrollable full-screen feed with prices |
| `/dashboard` | Analytics dashboard (key-protected) |

## Dashboard (design views)

Open **https://chandni-catalog.pages.dev/dashboard** and enter the dashboard passcode
(set as the `DASH_KEY` Pages secret). It shows, for today or all time, what percentage
of visitors opened each design full-screen.

- Passcode: `npx wrangler pages secret get DASH_KEY --project-name=chandni-catalog`
- Bookmarkable: `https://chandni-catalog.pages.dev/dashboard?key=<passcode>`

## Prices

The price catalog and admin pages use a separate `/prices` API backed by D1:

```bash
# View all prices
curl https://chandni-catalog.pages.dev/prices
# -> { "prices": { "item-id": 450, ... } }

# Set a price (via admin page or API)
curl -X POST -H "content-type: application/json" \
  -d '{"itemId": "item-id", "price": 450}' \
  https://chandni-catalog.pages.dev/prices
```

Prices are stored in the `prices` table (D1). A design with no price shows
"Price on request" in the price catalog.

## Viewing counter / hearts data

```bash
npx wrangler d1 execute chandni-catalog --remote --command "SELECT * FROM visits ORDER BY day DESC LIMIT 10;"
npx wrangler d1 execute chandni-catalog --remote --command "SELECT * FROM hearts ORDER BY count DESC;"
npx wrangler d1 execute chandni-catalog --remote --command "SELECT * FROM reach ORDER BY day DESC, depth;"
npx wrangler d1 execute chandni-catalog --remote --command "SELECT * FROM cta ORDER BY count DESC;"
npx wrangler d1 execute chandni-catalog --remote --command "SELECT * FROM sources ORDER BY day DESC, count DESC;"
npx wrangler d1 execute chandni-catalog --remote --command "SELECT * FROM designs ORDER BY sort_order;"
```

## Free-tier headroom

| Resource | Free allowance | Catalog usage |
|---------|---------------|--------------|
| Bandwidth | Unlimited | ~150KB per slide view |
| Builds | 500/month | 1 per deploy |
| Functions | 100k requests/day | ~2 per visitor (catalog + designs) |
| D1 storage | 5 GB | ~a few KB |
| R2 storage | 10 GB free | ~50MB (51 designs) |
| R2 Class A ops | 1M/month (free) | ~1 per design view |
| R2 Class B ops | 10M/month (free) | ~1 per page load |

## Video Call Booking (Business OS integration)

The "Book a video call" CTA is powered by the **Chandni Silk Mills Business OS** Worker
(`chandni-business-os`). When a customer taps it on the catalog:

1. An **inline booking modal** opens inside the catalog page — no redirect, no WhatsApp.
2. The customer enters **name + phone** (+ optional email + design interest).
3. On submit, the Worker:
   - Creates a **lead** in D1 (`chandni-business-db`)
   - Auto-finds the **next available 30-min slot** starting **tomorrow 12 PM IST**, walking to 8:30 PM
   - Creates a **Google Calendar event** via Composio
   - Appends a **row to Google Sheets**
4. The modal confirms the assigned date/time in IST.

### Tech details

| Component | URL / ID |
|-----------|----------|
| Worker | `https://chandni-business-os.kinger-siddharth.workers.dev` |
| Catalog → Worker endpoint | `POST /api/book-call` |
| Calendar connected account | `ca_39XTl8I61kM8` (personal Google Calendar) |
| Sheets connected account | `ca_3XDIUFtMAMym` |
| Google Sheet | `1gDzVo_lgfcS_XmD_Xwsuz83UmXvjKVV8Y8gglB7kCok` |
| Composio project | `pr_9oht8PRpJXqO` |

### Slot-finder logic

- Window: **tomorrow 12:00 PM → 8:30 PM IST**, 30-min increments
- Busy slots = existing Google Calendar events (via Composio `GOOGLECALENDAR_LIST_EVENTS`) + existing D1 `calendar_events`
- First free slot is assigned automatically
- If all 17 slots are busy, returns 409 with "All slots tomorrow 12–8 PM are booked"

### Backups

| Tag | Date |
|-----|------|
| `backup-catalog-2026-08-31` | Aug 31 2026 |
| `backup-business-os-2026-08-31` | Aug 31 2026 |

Feature branch: `feat/video-call-booking` in both repos.
