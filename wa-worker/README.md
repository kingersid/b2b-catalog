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

## Optional MCP tools

The Kimi sales loop can call tools exposed by one remote MCP server. Configure
`MCP_SERVER_URL` as a Worker variable, `MCP_SERVER_TOKEN` as a secret when the
server uses bearer authentication, and `MCP_ALLOWED_TOOLS` as a comma-separated
allowlist of exact tool names. Leave the tool list blank to expose all discovered
tools (up to the worker's bounded tool catalog). Leave `MCP_SERVER_URL` empty to
disable MCP.

The worker discovers tools with `initialize` and `tools/list`, passes only the
allowlisted schemas to Kimi, executes at most four tool calls per model turn,
and allows at most `MCP_MAX_TOOL_ROUNDS` follow-up rounds (default 2). Tool
failures are returned to the model as bounded errors; if discovery fails, the
existing sales flow continues without tools. MCP output is treated as data and
does not override the code-side price, handoff, link, or WhatsApp-send guards.

The `/admin` page also has an MCP connection panel for the private operator.
Enter the MCP server URL,
OAuth client ID, optional client secret, and exact comma-separated tool names,
then click **Connect MCP**. The Worker uses Authorization Code + PKCE, opens
the provider authorization page in a popup, validates the callback state, and
stores encrypted access/refresh tokens in D1. Add the callback URL shown by the
page to the OAuth client configuration. Apply the new `wa_mcp_oauth_pending`
and `wa_mcp_connections` tables from `schema.sql` before using this panel.
This admin-connected workspace is **not** offered to WhatsApp customers; their
only optional MCP source is the separate `MCP_SERVER_URL` sales configuration.

The private operator chat is on the **Worker origin**, at
`https://chandni-whatsapp-agent.kinger-siddharth.workers.dev/admin/chat`
(not the Pages catalog origin). It uses the same admin key but a separate
general-purpose prompt and tool loop. Kimi remains the default inference
provider, while OpenRouter can be selected per chat message with a live model
picker and a **Free only** filter. This selection does not change WhatsApp
customer replies, which continue to use Kimi. The operator can inspect the existing Notion
MCP connection and, when configured, search/extract/map/crawl the public web
through Tavily's remote MCP server. It can also read a direct public HTTP(S)
URL supplied in chat, while rejecting local/IP-address targets. Tavily and
direct-web tools are never added to the
customer WhatsApp loop. Operator replies can include links and are not put
through the sales reply sanitizer. Chat messages are stored by browser session
in `wa_operator_chat_messages`; no WhatsApp message is sent.

On the chat page, enter the admin key and click **Connect**. To enable web
tools, enter a Tavily MCP URL containing `tavilyApiKey` (or the key alone) in
the separate field and click **Connect Tavily MCP**. The Worker extracts the
key, authenticates to Tavily's remote MCP with a bearer header rather than a
credential-bearing URL, verifies tool discovery, encrypts it with
`AGENT_ADMIN_KEY`, and stores it in `wa_operator_tavily` in D1. The key is not
returned to the browser after saving. Alternatively, set the Worker secret
`TAVILY_API_KEY`; the admin-page key takes precedence. Apply `schema.sql` to
the production D1 database before deploying this version. The existing Notion
OAuth refresh token is renewed automatically when its access token expires;
if renewal fails, reconnect Notion from `/admin`.

To use OpenRouter, select it in the operator chat, enter an OpenRouter API key,
and click **Connect OpenRouter**. The Worker verifies the key with OpenRouter,
encrypts it with `AGENT_ADMIN_KEY`, and stores it in `wa_operator_openrouter`.
The key is never returned to the page. The model picker loads OpenRouter's
current catalog and shows models that advertise tool calling, with current
input/output prices. **Free only** shows explicit `:free` variants,
and the Worker refuses a paid model if free-only is
selected. The operator's provider, model, and filter choices persist in this
browser. Alternatively, set the Worker secret `OPENROUTER_API_KEY`; a key saved
through the page takes precedence. OpenRouter receives the operator's messages
and any tool results supplied to the model. Apply the new D1 table from
`schema.sql` before using OpenRouter. OpenRouter may impose separate limits or
charges; model pricing is shown before selection.

Tavily web access is to public Internet content through Tavily's MCP service,
subject to its account limits. It is not access to private networks or an
unrestricted browser runtime. Web and workspace content is treated as
untrusted data, not instructions.

Use MCP for read-only capabilities first, such as product search, CRM context,
or delivery-area lookup. Keep order placement, payment, price changes, and
outbound messaging behind a separate approval path rather than exposing them
directly to this customer-facing loop.

## Internal order inbox

Messages sent **from +91 95370 97267** to the production bot number **+91 83201 29806** use a separate order flow. Send “Please note this order” with the party and location. The bot returns an order number. Send marked photos and additional notes within one hour, then send `END ORDER` to close that group. A new “note this order” message starts a new group. Images are copied to private `wa-orders/` objects in R2; the operator can inspect them at the Worker's `/admin` page.

At 12:00 PM Asia/Kolkata each day, the Worker sends pending orders to +91 95370 97267. If the number messaged the bot in the previous 24 hours, it sends ordinary text; otherwise it uses the `chandni_pending_orders` English template on production WABA `2150197029173188`. That template must be approved by Meta. When finished, reply `COMPLETED 12` (using the actual order number), or reply `COMPLETED` directly to the original order acknowledgement. `PENDING` requests the current list at any time. A completed order stays in the database and disappears from future reminders.

Apply `wa-worker/orders.sql` once to production D1 before deploying this Worker. On an installation that already created `wa_orders` before the retry-safety column was added, run `ALTER TABLE wa_orders ADD COLUMN start_message_id TEXT;` followed by `CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_orders_start_message ON wa_orders(start_message_id);` once. `ORDER_IMAGES` binds the existing R2 bucket for private annotated photos. The `/api/designs?img=` proxy does not serve the `wa-orders/` prefix. Reminder attempts are recorded in `wa_order_reminders` to avoid duplicate noon sends; review any `failed` row and the Meta template status if no reminder arrives. The noon template is a Meta business-initiated message and may incur WhatsApp template charges.
