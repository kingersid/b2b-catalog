# Finish connecting the WhatsApp Worker

The Worker is live at `https://chandni-whatsapp-agent.kinger-siddharth.workers.dev` with its webhook at `/webhook`. Cutover completed on 27 September 2026: the WABA `messages` callback points here. This guide remains the reference for secret rotation, rollback, and any future re-cutover.

## Check five required secrets

In [Cloudflare Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages), open **chandni-whatsapp-agent → Settings → Runtime variables and secrets → Add variable**. For every row, select the **Secret** checkbox before deploying. After saving, confirm the **Type** column says `Secret` and the value is hidden. If the Type says `Variable` and the value is readable, delete that row and replace its value with a newly issued credential. Do not copy Cloudflare's generated `vars` snippet into Git, `wrangler.jsonc`, or chat.

| Secret name | Where to get its value |
|---|---|
| `META_VERIFY_TOKEN` | Make a new long random string in your password manager. Keep it there. You will enter the same string in Meta's **Verify token** field at cutover. |
| `META_APP_SECRET` | [Meta for Developers](https://developers.facebook.com/apps/) → app **wa-crm** (`1084450467911931`) → **App settings → Basic → App secret → Show**. |
| `META_ACCESS_TOKEN` | Reuse the working token in the n8n **Bearer Auth account** credential, or create a new non-expiring token under [Meta Business Settings](https://business.facebook.com/settings/) → **Users → System users → cli-bot → Generate new token**. Select app **wa-crm** and `whatsapp_business_messaging` plus `whatsapp_business_management`. Confirm `cli-bot` has full access to production WABA `2150197029173188` and phone number ID `1329088423615686`. Do not use a temporary WhatsApp Getting Started token or a similarly named test WABA. |
| `KIMI_API_KEY` | [Kimi API Platform](https://platform.kimi.ai/) → create an API key. Kimi API billing is separate from Kimi chat subscriptions. |
| `AGENT_ADMIN_KEY` | Make another long random string in your password manager. This is the password for the Worker's `/admin` inbox; use a different value from `META_VERIFY_TOKEN`. |

Cloudflare's [secret setup guide](https://developers.cloudflare.com/workers/configuration/secrets/) covers the dashboard flow. If a secret is lost, create a replacement and update it; the old value cannot be revealed from Cloudflare.

## Cutover record and checks

1. Open [health](https://chandni-whatsapp-agent.kinger-siddharth.workers.dev/health) and confirm `ok: true` and `database: connected`.
2. Open the [operator inbox](https://chandni-whatsapp-agent.kinger-siddharth.workers.dev/admin), enter `AGENT_ADMIN_KEY`, and confirm it connects. Click **Test Kimi and Meta connections**; both services should report ready. Keep this page monitored for handoffs and failed sends.
3. Done 27 September 2026. In the **wa-crm** app, the **WhatsApp Business Account** object's webhook config holds the production callback: `https://chandni-whatsapp-agent.kinger-siddharth.workers.dev/webhook` with `META_VERIFY_TOKEN` as the token, and the `messages` field subscribed. Caution: the app's **User** object has a separate webhook config that accepts the same values; saving there does not move WhatsApp message delivery.
4. Send `hi` to production WhatsApp number `+91 83201 29806` from a customer phone. Check that exactly one reply arrives and that the Worker inbox record is `done`. Then ask a specific design question to exercise Kimi. Check a human request reaches `/admin`.
5. If no correct reply arrives, restore the prior n8n callback `https://b2bsuratfab.app.n8n.cloud/webhook/whatsapp-catalog-agent` immediately. Do not leave two reply handlers active.

Changing the callback is the final live switch. The first release can show priced designs, ask a clarification, record opt-outs, and put stock, delivery, order, human, or non-text requests into the operator inbox. It does not confirm an order or promise availability.
