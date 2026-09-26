# Chandni WhatsApp Worker

This Worker can replace the n8n webhook for production WABA `2150197029173188` and phone ID `1329088423615686`. It uses the catalog's production D1 database, checks Meta's HMAC signature, deduplicates message IDs, calls Kimi for a structured decision, validates design IDs against active designs with positive saved prices, and sends replies through the WhatsApp Cloud API. Human handoffs and opt-outs stop bot replies for that number.

## Before switching Meta's webhook

1. Apply `wa-worker/schema.sql` to the **existing** `chandni-catalog` D1 database. The migration only adds `wa_inbox` and `wa_conversations`.
2. Deploy with `wrangler deploy --config wa-worker/wrangler.jsonc`. This creates a separate Worker and does not change the Pages catalog or Meta's current webhook.
3. Set these Worker secrets with `wrangler secret put NAME --config wa-worker/wrangler.jsonc`: `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_ACCESS_TOKEN`, `KIMI_API_KEY`, and `AGENT_ADMIN_KEY`. Use interactive input; do not put values in command arguments, source, or documentation. Reuse the existing Meta app's verification token and app secret when moving its callback.
4. Check `GET https://chandni-whatsapp-agent.<your-subdomain>.workers.dev/health`. Test `GET /webhook` with Meta's verification flow and a signed text webhook using the test WABA before moving the production callback.
5. In Meta, change the `messages` webhook callback to `https://chandni-whatsapp-agent.<your-subdomain>.workers.dev/webhook`. Keep the n8n workflow available for rollback until a live customer message receives a correct reply.

The Kimi model is `kimi-k2.6` with thinking disabled, JSON output, and a short output limit. Kimi API usage is billed separately even when Cloudflare stays within its free limits. The model receives message text, recent conversation snippets, and public design IDs/names. It does not receive the customer's WhatsApp number or saved rates. Rates are added in code after the model's IDs are checked against D1.

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
