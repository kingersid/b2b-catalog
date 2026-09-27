# WhatsApp sales agent: Cloudflare Worker implementation plan

**Status:** Live since 27 September 2026. The Worker at `https://chandni-whatsapp-agent.kinger-siddharth.workers.dev` is the production webhook for WABA `2150197029173188`, with Kimi K2.6 as the model. The Meta `messages` callback on the WhatsApp Business Account object points to the Worker; the published n8n workflow is retained solely for rollback. Remaining before the release is fully declared done: a verified live end-to-end message (release gate 6) and an unattended operator alert.

**Feature branch in progress:** `codex/catalog-metadata-multimodal` adds verified
product facts and inbound photo/voice handling. It requires D1 migrations and a
test-number check before deployment; see `docs/CATALOG_METADATA_AND_MEDIA.md`.

## Goal

Move the WhatsApp webhook and sales replies from n8n Cloud to a separate Cloudflare Worker. Use the existing catalog's production D1 database for active designs and saved rates, and use Kimi's Chat Completions API to interpret buyer messages. Keep Cloudflare usage within its free tier for as long as traffic permits. Kimi API usage and any chargeable Meta template messages are separate costs.

## Scope for the first live release

- Accept only signed webhook events for production WABA `2150197029173188` and phone number ID `1329088423615686`.
- Acknowledge Meta quickly, deduplicate by Meta message ID, and process text messages in the background with a D1 retry record.
- Read active designs and positive saved rates directly from D1. The model sees design IDs and names, but no rates or customer phone number.
- Let the agent hold a persona-driven conversation modeled on Meta's Business Assistant (language mirroring, buyer-profile memory, design suggestions, community invite). The buyer's own words gate price visibility in code (`B2B_PATTERN`); the model can never enable prices, and `sanitizeReply` strips any price, stock, discount, or link text from model-authored replies.
- Send replies through Graph API using the existing production phone ID. Record outcomes and make failed sends visible for review.
- Provide a clear operator handoff and a way to resume the bot. No automated order confirmation, discount, stock promise, delivery commitment, or payment instruction.

## Architecture

```text
Customer WhatsApp message
  -> Meta messages webhook
  -> Cloudflare Worker /webhook
       verify X-Hub-Signature-256 and WABA/phone IDs
       INSERT OR IGNORE message in D1; return HTTP 200
  -> background processing + one-minute retry sweep
       load conversation state and active priced designs from D1
       Kimi Chat Completions API: JSON intent + design IDs
       validate IDs; attach rates and share/image URLs in code
       send through Graph API; record result in D1
  -> operator review/handoff when needed
```

Use a plain Worker, D1 binding, and Cron Trigger initially. This avoids a paid n8n Cloud subscription and extra infrastructure. Add Cloudflare Queues or Durable Objects only if real traffic or failure data shows that the D1 inbox and cron sweep are insufficient.

## Delivery steps

### 1. Lock down the current baseline

- [ ] Export the **published** n8n workflow and record its current callback, credential names, and a few representative successful executions without copying tokens into the repo.
- [ ] Confirm the exact Meta app, WABA, and phone IDs against a real inbound webhook. Do not select assets by their display names.
- [x] Take a production D1 backup before applying the additive agent tables (local ignored `.wrangler/wa-pre-migration.backup.sql`).
- [ ] Record current behavior for greetings, catalog/rate requests, unknown requests, duplicate events, and Graph failures.

### 2. Finish the Worker and data model

- [x] Create a separate Worker draft and Wrangler configuration under `wa-worker/`.
- [x] Add D1 tables for webhook inbox and conversation mode; use an atomic insert to deduplicate messages.
- [x] Verify the Meta signature over the raw request body before parsing it.
- [x] Check WABA and phone number IDs, and ignore status and unsupported message events.
- [x] Add bounded processing retries for model/catalog failures; require review when a Graph send may have started, to avoid duplicate customer replies.
- [x] Add a protected operator inbox view for handoffs and messages needing review. The page refreshes while open; an unattended operator alert remains a later phase.
- [ ] Define retention and removal for stored customer message text and conversation records.
- [x] Route unsupported image, audio, and document messages to human handoff.

### 3. Connect Kimi and the catalog safely

- [x] Use `kimi-k2.6` with thinking disabled for low-cost testing; measure answer quality, latency, and token cost before changing it.
- [x] Request a JSON decision from the Chat Completions API with bounded output; validate actions and design IDs in Worker code.
- [x] Supply only recent message context and active catalog IDs/names to the model. Keep the WhatsApp number and saved rates out of the model request.
- [x] Recheck chosen IDs against current D1 results and attach the real rate in Worker code. Continue to keep the Meta Commerce feed at its fixed `1 INR` placeholder.
- [ ] Evaluate at least 25 anonymized buyer messages across English, Hindi/Hinglish, Gujarati, specific designs, vague requests, human requests, and prompt injection. Check that replies never invent price, stock, material, or dispatch terms.
- [ ] Define the customer-facing price policy explicitly before expanding to negotiated quotes or customer-specific rates. The first release preserves the existing WhatsApp behavior of quoting saved catalog rates.

### 4. Verify without affecting the live number

- [x] Run local checks for signature verification and validation of model-selected design IDs.
- [ ] Validate Wrangler configuration and run the Worker locally with a local D1 copy and non-production test secrets.
- [ ] Test webhook GET verification, valid and invalid HMAC signatures, duplicate deliveries, wrong WABA/phone IDs, missing secrets, Kimi timeout, malformed model response, D1 failure, and Graph rejection.
- [ ] Test a full signed inbound event on a Meta test number or isolated test app, including the outgoing reply and recorded D1 status.
- [x] Stage an allowlisted Pages asset directory so Worker source, agent schema, and local test data are not included in future catalog deploys.

### 5. Deploy and cut over

- [x] Apply `wa-worker/schema.sql` to production D1 after the backup; verify both new tables exist and the catalog still has 61 designs.
- [x] Deploy the Worker as a separate `workers.dev` service and configure the five required secrets; see `wa-worker/SETUP.md`.
- [x] Confirm `/health`, D1 binding, webhook verification, and protected operator endpoints on the deployed Worker.
- [x] Verify a human can claim and resume a conversation from the operator inbox (`/admin`) before live cutover.
- [ ] Add an unattended operator alert for handoffs and `needs_review` rows (for example, a WhatsApp template message to the owner's number). Polling `/admin` alone is not an alert.
- [x] Change the Meta app's `messages` callback on the **WhatsApp Business Account** object to the Worker URL and confirm verification (27 September 2026). Cautions learned during cutover: (a) the app's **User** object has a separate webhook configuration that looks identical; saving there does not move message delivery. (b) The dashboard's *Verify and save* does not reliably create the app→WABA `subscribed_apps` entry, and the WABA callback can silently revert — delivery then continues on the old path while the dashboard looks correct. The Worker's `/admin` self-test now reads the live subscription and callback from the Graph API and can auto-subscribe, so audit there instead of trusting the dashboard.
- [x] Send a live message to `+91 83201 29806` after cutover; verify exactly one correct reply, a `done` row in `wa_inbox`, and no new n8n production execution (verified 27 September 2026: persona reply, B2B unlock, and community CTA all confirmed in D1).
- [x] Keep the n8n workflow and callback details available for rollback until live traffic is stable. Do not run two reply handlers for the same incoming message.

### 6. Operate and measure

- [ ] Monitor webhook acceptance, signature failures, pending age, `needs_review` records, Graph errors, model errors, handoff age, and daily reply count.
- [ ] Review Cloudflare Worker requests and D1 rows read/written, plus Kimi tokens and spend, weekly.
- [ ] Establish a simple rollback: restore Meta's previous n8n callback and confirm a test reply. Keep message-ID deduplication in mind during any switch.
- [ ] Only cancel n8n Cloud after the Worker has handled representative live traffic and operator handoff works.

## Release gates

The Worker is ready to become the production webhook only when all of these are true:

1. Meta verification and signed webhook tests pass on the deployed URL.
2. A duplicate inbound message yields one reply; wrong WABA/phone events yield none.
3. Every product reply references an active design and its positive saved D1 rate; no saved rate enters `/meta-feed`.
4. Kimi or catalog failure produces a tracked retry or review item, and an uncertain Graph send is never retried automatically.
5. A handoff alerts a person, mutes the bot, and can be resumed deliberately.
6. A real customer message receives one correct reply after cutover, and the previous n8n callback can be restored quickly.

## Cost boundary

Cloudflare currently lists **100,000 Worker requests per day** on the free plan, with a **10 ms CPU time limit per invocation**; D1 lists **5 million rows read and 100,000 rows written per day**, with 5 GB of storage on the free plan. These are account-level limits and can change. The Worker should stay small and measure actual usage. Kimi charges per token even while Cloudflare remains free. Meta may charge for approved template messages outside the customer service window.

Sources: [Cloudflare Worker pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Kimi JSON mode](https://platform.kimi.ai/docs/guide/use-json-mode-feature-of-kimi-api), [Kimi K2.6](https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart).
