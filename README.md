# Chandni Silk Mills — Catalog (Cloudflare Pages + D1 + R2)

A mobile first fabric catalog with private wholesale pricing, WhatsApp sharing, and
automatic synchronization to a Meta Commerce catalog. It runs on Cloudflare Pages,
D1, and R2.

## Daily Catalog Workflow

### Add and publish a design

1. Open [Upload Designs](https://chandni-catalog.pages.dev/upload) and upload a portrait photo.
2. Open [Catalog Admin](https://chandni-catalog.pages.dev/admin), enter the access key, and set the real wholesale price.
3. Check [Price Catalog](https://chandni-catalog.pages.dev/price-catalog). The saved price appears immediately.
4. Meta reads the live feed every hour and adds the design automatically.

The real wholesale price stays on the Chandni catalog. Meta receives a fixed **₹1
placeholder** and **“Price on request”** for every product.

### Hide or restore a design

1. Open [Catalog Admin](https://chandni-catalog.pages.dev/admin).
2. Select **Hide** on a design to remove it from the public catalog and Meta feed.
3. Select **Restore** to publish it again. If it has a saved positive price, it returns to the Meta feed automatically.

```text
Upload → Set real price → Website updates immediately → Meta updates hourly
Hide   → Website removes item immediately → Meta removes it on its next refresh
```

## Live Pages

| Page | Purpose |
|------|---------|
| [Main catalog](https://chandni-catalog.pages.dev/) | Customer grid and full-screen design viewer |
| [Price catalog](https://chandni-catalog.pages.dev/price-catalog) | Customer catalog with real saved prices |
| [Upload](https://chandni-catalog.pages.dev/upload) | Add portrait design photos |
| [Admin](https://chandni-catalog.pages.dev/admin) | Set prices and hide or restore designs |
| [Available designs](https://chandni-catalog.pages.dev/available-catalog) | Live, price-free assortment of designs marked available in admin |
| [Meta feed](https://chandni-catalog.pages.dev/meta-feed) | Scheduled CSV source with placeholder prices |
| [Dashboard](https://chandni-catalog.pages.dev/dashboard) | Catalog engagement analytics |
| [Privacy policy](https://chandni-catalog.pages.dev/privacy) | Customer data and WhatsApp automation policy |

## Price Privacy

- D1 stores the real price.
- The website price catalog displays the real price.
- The Meta feed uses `1 INR` for every listed design and labels it `Price on request`.
- A design must still have a positive saved price before the Meta feed publishes it.
- Do not change the feed to export the real D1 price.

## WhatsApp AI Agent

The live implementation plan for the WhatsApp sales agent is [plan.md](plan.md); the
Worker code and operator guide are under `wa-worker/` (see
[wa-worker/README.md](wa-worker/README.md)). The long-term staged roadmap covering
catalog data, hosted CRM infrastructure, deterministic product tools, AI evaluation,
human approval, controlled rollout, and order automation remains in
[docs/WHATSAPP_AI_AGENT_ROADMAP.md](docs/WHATSAPP_AI_AGENT_ROADMAP.md).

The live catalog admin now has verified sales details for each design. The Worker
uses those facts for recommendations and can interpret customer photos and voice
notes. See [docs/CATALOG_METADATA_AND_MEDIA.md](docs/CATALOG_METADATA_AND_MEDIA.md)
for the operator workflow and test status. Product details must be entered by the
team before the agent can use them; the **Agent ready** count in admin shows progress.
When a buyer asks for all ready or available designs, the Worker sends one link to
the full available-designs page. Normal recommendations still show up to three designs.

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
| `/upload` | Add portrait design photos |
| `/admin` | Enter/edit real prices and hide or restore designs |
| `/price-catalog` | Price catalog — scrollable full-screen feed with prices |
| `/meta-feed` | Meta CSV feed with fixed placeholder prices |
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

# Set a price (normally use the admin page)
curl -X POST -H "content-type: application/json" -H "x-upload-key: <UPLOAD_KEY>" \
  -d '{"itemId": "item-id", "price": 450}' \
  https://chandni-catalog.pages.dev/prices
```

Prices are stored in the `prices` table (D1). A design with no price shows
"Price on request" in the website price catalog and is excluded from the Meta feed.
The Meta feed uses the saved positive price only as a publication gate and replaces
its value with the fixed `1 INR` placeholder.

## WhatsApp catalog agent

A Cloudflare Worker (`chandni-whatsapp-agent`) is the production agent since
**27 September 2026**. It verifies Meta's signature, deduplicates messages, asks
**Kimi K2.6** for a structured JSON decision, validates design IDs against this
catalog's production D1, and replies with priced designs, one clarification, a human
handoff, or an opt-out confirmation. Operator inbox: `wa-worker` `/admin`.
Full details: [plan.md](plan.md) and [wa-worker/README.md](wa-worker/README.md).

### Live configuration

| Component | Value |
|-----------|-------|
| WhatsApp Cloud API number | `+91 83201 29806` |
| Meta app | `wa-crm` (`1084450467911931`) |
| Production WABA | `2150197029173188` |
| Phone number ID | `1329088423615686` |
| Agent Worker | `https://chandni-whatsapp-agent.kinger-siddharth.workers.dev/webhook` |
| Model | Kimi `kimi-k2.6` (JSON mode, thinking disabled) |
| Rollback webhook | `https://b2bsuratfab.app.n8n.cloud/webhook/whatsapp-catalog-agent` |
| n8n workflow (rollback only) | `WhatsApp Catalog Agent - Designs with Rates` (`pHwtP2qmCM2R4geC`) |

The n8n workflow stays published but receives no traffic. To roll back, point the
WABA webhook callback back to n8n and confirm a test reply — never run both
handlers at once.

### Customer flow

1. The customer sends a text to the WhatsApp number.
2. Meta delivers the signed event to the Worker webhook.
3. The Worker loads active designs and positive saved rates from D1, and asks Kimi
   for an intent decision (`show_designs`, `clarify`, `handoff`, or `optout`).
4. It replies with up to three design images with rates and share links, one
   clarification question, or a handoff message; every price comes from D1 in code,
   never from the model.

The Worker uses a permanent Meta system-user token stored as its
`META_ACCESS_TOKEN` secret (originally the n8n `Bearer Auth account` credential).
The token is deliberately absent from this repository.
Do not add tokens, OTPs, webhook verification secrets, or n8n credentials to Git.

### Meta permissions that must remain in place

System user `cli-bot` (`61591111234154`) needs full access to:

- App `wa-crm` (`1084450467911931`)
- Production WABA `Surat B2B fabrics` (`2150197029173188`)

The token requires `whatsapp_business_management` and
`whatsapp_business_messaging`. A valid token without access to the production WABA
causes Meta to return HTTP 400 `Authorization Error` with code 100.

### Troubleshooting

- **No reply at all:** check the Worker's D1 `wa_inbox` rows and Cloudflare Worker
  logs, then the Meta `messages` subscription on the **WABA object** of the
  webhook config (the User object has a separate, unrelated webhook config).
- **OAuth code 190:** the token expired or was revoked; generate another permanent
  system-user token and update the Worker's `META_ACCESS_TOKEN` secret.
- **HTTP 400, code 100:** confirm the system user has access to WABA
  `2150197029173188`; similarly named WABAs are present in the portfolio.
- **Message arrives but reply is missing:** check `wa_inbox.status` —
  `needs_review` rows and handoffs appear in the Worker `/admin` inbox; a model or
  catalog failure retries up to three times before needing review.

## Meta Commerce catalog feed

Meta Commerce can fetch the live CSV at:

```text
https://chandni-catalog.pages.dev/meta-feed
```

Configure Commerce Manager to fetch it on a recurring **replace** schedule. The
feed includes active, priced designs only. Therefore:

```text
Upload design -> set price -> appears in the website catalog and Meta feed
Hide design   -> disappears from the website catalog and the next Meta replacement
```

The feed keeps real rates in D1 and WhatsApp while sending the numeric placeholder
`1 INR` and the label `Price on request` to Meta. Meta requires a numeric currency
price, so literal `xxx` is not a valid feed value. A positive saved rate remains
the publication gate, but its value is never written to the Meta feed.

The one-time CSV generator remains available as:

```bash
node scripts/build-meta-feed.mjs
```

Production synchronization should use `/meta-feed`; `meta-catalog-import.csv` is a
snapshot and will become stale.

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

## CRM automation roadmap (TODO)

This is the working checklist for turning the WhatsApp operator into a lightweight
CRM. The fresh Notion database has **not** been created yet, and the production
Worker still needs its Notion connection, migration, and deployment.

### Fresh Notion database: `Chandni Orders`

Create one database with these properties:

| Property | Type | Purpose |
|----------|------|---------|
| Order ID | Title | Stable human-readable order reference |
| Customer name | Text | Buyer or firm contact |
| WhatsApp number | Phone | E.164 number used for replies |
| Firm / city | Text | Customer context |
| Products | Text | Design names, quantities, and notes |
| Order date | Date | Date the order was noted |
| Payment status | Select | `Pending`, `Part paid`, `Paid`, `Overdue`, `Unknown` |
| Dispatch status | Select | `Not ready`, `Packed`, `Dispatched`, `Delivered`, `Hold` |
| Order status | Select | `New`, `Confirmed`, `Processing`, `Complete`, `Cancelled` |
| Amount due | Number | Outstanding amount in INR |
| Next action | Date | When the next follow-up should happen |
| Notes | Text | Human edits and conversation context |
| Last contact | Date | Last WhatsApp or call activity |
| Source message ID | Text | Idempotency key for webhook retries |

Recommended views: **Today**, **Payment pending**, **Overdue**, **Ready to dispatch**,
**Needs review**, and **Completed**.

### Implementation checklist

- [ ] Create the `Chandni Orders` Notion database and save its database ID as a Worker secret.
- [ ] Give the Notion integration access to the database.
- [ ] Add an idempotent order upsert keyed by `Source message ID` or `Order ID`.
- [ ] Route owner messages through the operator agent, with explicit `note order` as the order action.
- [ ] Write new orders and edits to Notion while keeping the operator reply short and clear.
- [ ] Add status-triggered WhatsApp and Sarvam action drafts, with human approval before sending or calling.
- [ ] Persist WhatsApp delivery results and Sarvam call outcomes back to the order page.
- [ ] Deploy the Worker migration and test one order from WhatsApp through Notion and back.

### Useful CRM automations

1. **Idempotent order capture.** Extract the order once, show a confirmation summary,
   and update the same Notion page when the customer adds quantities or changes a design.
2. **Status playbooks.** `Payment pending` creates a WhatsApp reminder draft;
   `Overdue` creates a Sarvam payment-timing call draft; `Paid` creates a dispatch
   checklist; `Dispatched` creates a tracking confirmation draft.
3. **Human-in-the-loop outbound queue.** Put every outbound WhatsApp message and
   voice call into a review queue with recipient, template variables, reason, and expiry.
   Approval prevents duplicate or accidental calls.
4. **Next-action timers.** Set `Next action` whenever an order is created or contacted.
   A scheduled Worker job can surface due items each morning and group them by customer.
5. **Conversation memory with confidence.** Store the exact customer message and a
   confidence level. Low-confidence extraction goes to **Needs review** instead of
   silently changing an order.
6. **Two-way reconciliation.** After WhatsApp delivery, reply, call completion, or
   call failure, append a short event to `Notes`, update `Last contact`, and move the
   status only when the result is known.
7. **Duplicate and consent guardrails.** Suppress repeated reminders inside a cooldown
   window, respect opt-outs, and require a valid E.164 number before any outbound action.
8. **Daily control-tower digest.** Send the owner one compact morning summary: new
   orders, overdue payments, calls awaiting approval, failed deliveries, and orders with
   no next action.

### Isolated agent terminal (TODO)

Add a Cloudflare Sandbox execution environment so the owner agent can run general
Node.js and Python scripts without accessing a personal computer or the Worker runtime.
The Sandbox SDK requires a compatible package and container image, Docker for the first
build, and a Cloudflare Workers Paid plan. Keep this work separate from the Worker until
those prerequisites are available.

Security requirements:

- [ ] Expose execution only to the authenticated owner/operator session.
- [ ] Use a stable per-owner sandbox ID and an isolated filesystem.
- [ ] Enforce a short timeout, output-size limit, and command-length limit.
- [ ] Keep Worker secrets out of the sandbox environment.
- [ ] Record command, timestamp, exit code, and truncated output in an audit log.
- [ ] Require confirmation before scripts can change production data or send messages.

Potential use cases:

- Generate daily pending-payment, dispatch, and sales reports from D1 exports.
- Clean, merge, validate, and format customer/order CSV files before importing them.
- Reconcile WhatsApp delivery events, Sarvam call results, and Notion order pages.
- Calculate follow-up priorities, overdue buckets, customer totals, and sales summaries.
- Prepare approved WhatsApp template variables and Sarvam campaign cohorts for review.
- Run data-quality checks for missing phone numbers, duplicate orders, or invalid statuses.
- Create one-off product, pricing, or catalog analysis with Python and pandas.
- Run regression checks against the Worker’s order and messaging logic after changes.
- Transform customer-provided spreadsheets into the Notion import format.
- Produce a downloadable report or chart for the owner without exposing database credentials.

The first release should support general `node` and `python` scripts inside the isolated
Sandbox, while keeping outbound WhatsApp, Sarvam, Notion, and production database writes
behind explicit operator confirmation.
