# Chandni WhatsApp Worker

This Worker is the production webhook (since 27 September 2026) for production WABA `2150197029173188` and phone ID `1329088423615686`. It uses the catalog's production D1 database, checks Meta's HMAC signature, deduplicates message IDs, and runs a persona-driven sales agent on Kimi modeled on Meta's Business Assistant behavior (see `docs/META_ASSISTANT_PLAYBOOK.md`): it mirrors the customer's language, remembers their name, city, business type and use case, shows matching designs, and offers the free WhatsApp community.

**Price gate (code-enforced, not prompt-enforced).** Rates are shown only after the buyer's own words indicate B2B intent — shop owner, reseller, manufacturer, wholesale/bulk buyer (regex `B2B_PATTERN`, multilingual Hindi/Gujarati/Hinglish). The model can never enable prices by claiming B2B, and every model-authored free-text reply is passed through `sanitizeReply`, which drops any reply containing prices, discount or stock promises, or links. Captions carry rates only from validated D1 designs and only when the gate is open.

## Deployment state and rollback

Current production state (cutover completed 27 September 2026):

1. `wa-worker/schema.sql` is applied to the production `chandni-catalog` D1 database (adds `wa_inbox` and `wa_conversations`).
2. The Worker is deployed with `wrangler deploy --config wa-worker/wrangler.jsonc`. The catalog Pages site and metadata editor were also deployed on 27 September 2026.
3. Secrets are configured: `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_ACCESS_TOKEN`, `KIMI_API_KEY`, and `AGENT_ADMIN_KEY`. Rotate with `wrangler secret put NAME --config wa-worker/wrangler.jsonc` using interactive input; do not put values in command arguments, source, or documentation.
4. In the Meta app, the `messages` callback on the **WhatsApp Business Account** object points to `https://chandni-whatsapp-agent.kinger-siddharth.workers.dev/webhook` with the `messages` field subscribed. The app's **User** object has a separate webhook configuration; only the WABA object carries message events.

To roll back, set the WABA object's callback back to `https://b2bsuratfab.app.n8n.cloud/webhook/whatsapp-catalog-agent` and confirm a test reply. Message-ID deduplication lives in the Worker's `wa_inbox`, which n8n does not read — never run both handlers at once.

The Kimi model is `kimi-k2.6` with thinking disabled, JSON-envelope output (`reply`, `design_ids`, `handoff`, `optout`, `community`, `profile`), and a bounded output limit. Kimi API usage is billed separately even when Cloudflare stays within its free limits. The model receives message text, recent conversation snippets, the stored buyer profile, and public design IDs/names. It does not receive saved rates. Rates are added in code after the model's IDs are checked against D1, and only for B2B-qualified conversations.

`COMMUNITY_URL` in `wrangler.jsonc` holds the free WhatsApp community invite link (recovered from the team's own sent history). The agent is instructed to invite every first-time customer to the community as a mid-funnel step; code appends the actual link and enforces a 14-day once-per-conversation cooldown, so the link can never repeat-spam a buyer. Leave the value empty to disable the CTA. Only code sends this link.

## Operations

- Open `/admin` in a browser and enter `AGENT_ADMIN_KEY` to watch handoffs and send failures. The key stays in page memory and must be entered again after reload.
- After connecting, click **Test Kimi and Meta connections**. It checks the current catalog, asks Kimi for a sample decision, and confirms the Meta token can see the production phone. It does not send a WhatsApp message.
- `GET /admin/handoffs` with header `x-agent-admin-key` lists conversations awaiting a person. Check this list regularly; the Worker does not yet send an operator alert.
- `GET /admin/review` with the same header lists messages that need send or processing review.
- `POST /admin/resume` with the same header and JSON `{ "waId": "91..." }` returns a human-held conversation to bot mode.
- `wa_inbox.status = 'needs_review'` identifies messages whose Graph send failed or whose processing failed three times. Review these rows before retrying to avoid duplicate customer replies.
- A cron run every minute retries model/catalog failures. It never automatically repeats a Graph send once sending started.
- The Worker ignores status events and webhook payloads for other WABA/phone IDs. It processes photos and voice notes while documents and videos still reach a person.

Verified product details are included in the model's catalog context. Both D1
migrations were applied in production on 27 September 2026; do not rerun the media
`ALTER TABLE` migration. See [Catalog metadata and media](../docs/CATALOG_METADATA_AND_MEDIA.md).
Photo replies use model-selected, code-validated IDs with a fixed introduction. Voice
notes are transcribed through the new `AI` binding; transcription alone never unlocks
the B2B price gate. Documents and videos continue to reach a person.

A request such as “send me ready available designs” takes a deterministic route:
the Worker sends `/available-catalog`, a live page containing every active, positively
priced design explicitly marked **Available** in admin. The page never exposes
private rates. Ordinary recommendations retain the three-image limit.

The customer-facing sales agent does not confirm buyer orders, guarantee availability or dispatch, or negotiate discounts. The internal order reminder below uses an approved template outside the customer-service window.

## Internal order inbox

Messages sent **from +91 95370 97267** to the production bot number **+91 83201 29806** use a separate order flow. Send “Please note this order” with the party and location. The bot returns an order number. Send marked photos and additional notes within one hour, then send `END ORDER` to close that group. A new “note this order” message starts a new group. Images are copied to private `wa-orders/` objects in R2; the operator can inspect them at the Worker's `/admin` page.

At 12:00 PM Asia/Kolkata each day, the Worker sends pending orders to +91 95370 97267. If the number messaged the bot in the previous 24 hours, it sends ordinary text; otherwise it uses the `chandni_pending_orders` English template on production WABA `2150197029173188`. That template must be approved by Meta. When finished, reply `COMPLETED 12` (using the actual order number), or reply `COMPLETED` directly to the original order acknowledgement. `PENDING` requests the current list at any time. A completed order stays in the database and disappears from future reminders.

Apply `wa-worker/orders.sql` once to production D1 before deploying this Worker. On an installation that already created `wa_orders` before the retry-safety column was added, run `ALTER TABLE wa_orders ADD COLUMN start_message_id TEXT;` followed by `CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_orders_start_message ON wa_orders(start_message_id);` once. `ORDER_IMAGES` binds the existing R2 bucket for private annotated photos. The `/api/designs?img=` proxy does not serve the `wa-orders/` prefix. Reminder attempts are recorded in `wa_order_reminders` to avoid duplicate noon sends; review any `failed` row and the Meta template status if no reminder arrives. The noon template is a Meta business-initiated message and may incur WhatsApp template charges.
