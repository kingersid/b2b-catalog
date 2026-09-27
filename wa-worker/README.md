# Chandni WhatsApp Worker

This Worker is the production webhook (since 27 September 2026) for production WABA `2150197029173188` and phone ID `1329088423615686`. It uses the catalog's production D1 database, checks Meta's HMAC signature, deduplicates message IDs, and runs a persona-driven sales agent on Kimi modeled on Meta's Business Assistant behavior (see `docs/META_ASSISTANT_PLAYBOOK.md`): it mirrors the customer's language, remembers their name, city, business type and use case, shows matching designs, and offers the free WhatsApp community.

**Price gate (code-enforced, not prompt-enforced).** Rates are shown only after the buyer's own words indicate B2B intent — shop owner, reseller, manufacturer, wholesale/bulk buyer (regex `B2B_PATTERN`, multilingual Hindi/Gujarati/Hinglish). The model can never enable prices by claiming B2B, and every model-authored free-text reply is passed through `sanitizeReply`, which drops any reply containing prices, discount or stock promises, or links. Captions carry rates only from validated D1 designs and only when the gate is open.

## Deployment state and rollback

Current production state (cutover completed 27 September 2026):

1. `wa-worker/schema.sql` is applied to the production `chandni-catalog` D1 database (adds `wa_inbox` and `wa_conversations`).
2. The Worker is deployed with `wrangler deploy --config wa-worker/wrangler.jsonc`; the Pages catalog is untouched.
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
- The Worker ignores status events and webhook payloads for other WABA/phone IDs. Photos, voice notes, documents and other non-text messages enter the human handoff inbox.

This is a controlled first version. It does not confirm orders, guarantee availability or dispatch, negotiate discounts, or send approved WhatsApp templates outside the customer-service window.
