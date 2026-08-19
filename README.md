# Chandni Silk Mills — Catalog (Cloudflare Pages)

Migrated from the Netlify Drop app (`Photos-1-001`) to **Cloudflare Pages + D1** because
Netlify's free tier (100 GB/month bandwidth) was exhausted. Cloudflare Pages has
**unlimited bandwidth**, 500 builds/month, and 100k free function requests/day.

## What changed vs. the Netlify version

- **All videos removed** (per request) — the feed is images only, and `index.html`
  no longer contains video code paths.
- **Images optimized**: each JPG now has a `mid/` (1000px, q72, ~200KB avg) and `webp/`
  (1600px, q75, ~450KB avg) WebP sibling. The feed loads `mid/` first, upgrades to `webp/`
  for the active slide, and falls back to the original JPG only if WebP is unavailable.
  Total image weight: **9.5MB (mid) + 19.3MB (webp)** vs. **102MB of raw JPGs**.
- **Cache headers** (`_headers`): `mid/` and `webp/` are cached on the CDN edge for a year
  (immutable filenames), `index.html` revalidates so new deploys show immediately.
- **Measured** (Lighthouse mobile, throttled 4G): performance **99/100**, LCP **1.3s**,
  CLS 0, total transferred bytes **2.5MB** for a full scroll-through of the feed.
- **Landing slide**: `landing.png` (2.1MB) replaced by `landing.webp` (110KB);
  since 2026-08-17 it's the **closing poster card** after the last design, not the entry gate.
- **Backend**: `netlify/functions/catalog.js` + Netlify Blobs →
  `functions/api/catalog.js` + **D1** (SQLite). Same API contract:
  `GET/POST /api/catalog?action=siteVisits|addVisit|hearts|heart`.
  Frontend call site changed from `/.netlify/functions/catalog` to `/api/catalog`.
- **Conversion tracking (2026-08-16)**: WhatsApp CTA clicks are recorded per design
  (`POST /api/catalog?action=ctaClick`) and shown as a 📞 column in the dashboard;
  the Meta Pixel Lead event now carries the design filename as `content_name`.
- **Traffic sources (2026-08-16)**: `addVisit` accepts a `source` (utm/src param >
  referrer host > `direct`), stored in the `sources` table and shown on the dashboard.
- **Grid → detail UX (2026-08-17)**: the landing poster no longer gates the feed
  (56% of visitors bounced before image #1). The catalog now lands on a 3-column
  grid of **all** designs; tapping one opens the full-screen slide view, with a
  closing poster card after the last design.
- **Design views (2026-08-17)**: scroll depth no longer exists (the grid shows every
  design at once), so `reach` now records which designs are **opened** full-screen
  (`POST body {depth}` only — no backfill, since jumping to #30 doesn't mean the
  visitor saw #1-29). The dashboard's bars are "sessions that opened design N".

## Deploy (one-time setup)

```bash
# 0. Install wrangler (Node 18+)
npm i -g wrangler

# 1. Create the D1 database
npx wrangler d1 create chandni-catalog
#    -> copy the "database_id" from the output into wrangler.toml

# 2. Create the tables
npx wrangler d1 execute chandni-catalog --remote --file=schema.sql

# 3. Deploy the site (static files + functions/ are uploaded together).
#    `npm run deploy` runs the portrait-image guard first and aborts if any
#    image is landscape, then deploys.
npm run deploy
#    (or, to skip the guard intentionally: npx wrangler pages deploy . --project-name=chandni-catalog)

# 4. (Optional) custom domain: Cloudflare dashboard -> Workers & Pages -> chandni-catalog -> Custom domains
```

The site will be live at `https://chandni-catalog.pages.dev`.

## Local development

Run the site locally (static files + the `/api/catalog` function + D1 binding):

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

**Secrets** — `DASH_KEY` is a Pages secret, which local dev doesn't have; the
`/dashboard` page will show "dashboard key not configured" unless you add a fallback
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
curl http://localhost:8788/api/catalog             # { today, count } site visits
curl http://localhost:8788/api/catalog?action=hearts   # hearts JSON
```

Note: opening `index.html` directly from the filesystem (`file://`) also works for a
quick look at the feed — the frontend detects it and serves engagement requests from
the deployed backend — but the local server above is the full dev experience.

## Adding a new design

1. Drop the photo into this folder as `something.jpg`.
2. Generate the optimized siblings. **Photos must be portrait** (height > width) — the
   feed is full-screen portrait. The `-auto-orient` flag fixes phone photos stored
   sideways; if the photo is genuinely landscape, convert it to portrait first
   (center-crop, or blur-fill: full photo centered on a blurred portrait canvas):
   ```bash
   magick something.jpg -auto-orient -resize 1000x1000 -quality 72 mid/something.webp
   magick something.jpg -auto-orient -resize 1600x1600 -quality 75 webp/something.webp
   ```
   Then rotate the source itself so the fallback JPG is upright too:
   `magick mogrify -auto-orient -quality 95 something.jpg`
3. Add `"something.jpg"` to the `FILES` array in `index.html`.
4. Redeploy: `npm run deploy`

## Portrait-mode guard (enforced, no exceptions)

Every image in the project must display in portrait (height ≥ width). A deploy-time
check (`scripts/check-portrait.mjs`, run automatically by `npm run deploy`) scans
**all** images — root JPGs, `mid/`, `webp/`, `landing.webp` — and aborts the deploy
if any is landscape or would render sideways via an EXIF rotation flag:

```bash
npm run check:portrait   # standalone: exit 0 = all portrait, 1 = abort
```

It is dependency-free (parses JPEG/WebP/PNG/GIF headers directly) and understands
EXIF orientation, so a sideways-stored phone photo (e.g. 4032x3024, Orientation=6)
is correctly treated as portrait — but a genuinely landscape image fails the check.

## Dashboard (design views)

Open **https://chandni-catalog.pages.dev/dashboard** and enter the dashboard passcode
(set as the `DASH_KEY` Pages secret). It shows, for today or all time, what percentage
of visitors opened each design full-screen (image 1 = 100% baseline). Bars show
"sessions that opened design #N" (the grid lets visitors jump straight to any design),
plus a 📞 WhatsApp-CTA-clicks column and a traffic-sources card.

- Passcode: `npx wrangler pages secret get DASH_KEY --project-name=chandni-catalog` (or reset with `put`)
- Bookmarkable: `https://chandni-catalog.pages.dev/dashboard?key=<passcode>`
- Data lives in the `reach` table: one row per (day, depth), where depth N's count =
  sessions that opened design N full-screen (no backfill — jumps don't imply skipped
  designs were seen).

## Viewing counter / hearts data

```bash
npx wrangler d1 execute chandni-catalog --remote --command "SELECT * FROM visits ORDER BY day DESC LIMIT 10;"
npx wrangler d1 execute chandni-catalog --remote --command "SELECT * FROM hearts ORDER BY count DESC;"
npx wrangler d1 execute chandni-catalog --remote --command "SELECT * FROM reach ORDER BY day DESC, depth;"
npx wrangler d1 execute chandni-catalog --remote --command "SELECT * FROM cta ORDER BY count DESC;"
npx wrangler d1 execute chandni-catalog --remote --command "SELECT * FROM sources ORDER BY day DESC, count DESC;"
```

## Performance work — IN PROGRESS (2026-08-17)

Status of the "elite loading times" push (Lighthouse mobile, throttled 4G, live site):

**Done & deployed:**

- **Root cause found**: the landing poster (`landing.webp`) was gated behind an
  opacity fade-in (`opacity: 0` until its `load` event). Chrome never counts an
  invisible image as contentful, so the poster was excluded from LCP entirely and
  the metric fell to the bottom peek strip (7.0s LCP). Fix: `.slide.intro .media
  img.full { opacity: 1; }` — the poster is fully opaque from its first paint.
- **Killed the load-time full-res upgrades**: `markReady` upgraded every loaded
  slide to the 460KB `webp/` version at page load (the `index > 0` check even
  included the first product slide) — ~1.3MB racing the poster. Now only
  `update()` upgrades the *active* slide. First-load transfer dropped from
  **~2.2MB → ~280KB** (just `landing.webp` + the first product's `mid/`).
- **Result**: LCP **7.0s → 3.8s**, Performance **0.86**, CLS 0.

**Next steps (unfinished):**

- [ ] **Investigate the 3.8s vs 614ms gap**: the LCP breakdown sums to ~0.6s
      (TTFB 460ms + load delay 10ms + load 52ms + render 92ms) yet Lighthouse
      reports 3.8s — a *later* LCP candidate exists in the trace. Capture a trace
      (`npx lighthouse ... --save-assets`) and find what re-paints at ~3.8s.
      Suspect: the LQIP fade-out transition, or a repaint of the poster. Target:
      LCP < 1.2s (green).
- [ ] **FCP is 1.2s** on throttled mobile — the 51 inline base64 LQIPs decode on a
      4x-slower CPU. Options: trim LQIP sizes, lazy-build slides, or split the
      LQIP object out of the critical path.
- [ ] Re-run Lighthouse after any change; delete the saved `*.json`/trace files
      from the project root before deploying (Pages rejects files > 25MB — a
      68MB trace blocks `wrangler pages deploy`).
- [ ] Re-measure the full suite (FCP / LCP / Speed Index / TBT / CLS) once LCP
      is green, and update the "Measured" bullet at the top of this README.

## Free-tier headroom

| Resource | Free allowance | Catalog usage |
|---|---|---|
| Bandwidth | Unlimited | ~150KB per slide view |
| Builds | 500/month | 1 per deploy |
| Functions | 100k requests/day | ~1 per visitor |
| D1 storage | 5 GB | ~a few KB |
