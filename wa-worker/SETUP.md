# Finish connecting the WhatsApp Worker

The Worker is deployed at `https://chandni-whatsapp-agent.kinger-siddharth.workers.dev`. Its webhook endpoint is the same address with `/webhook`. The production Meta callback still points to n8n until the steps below are complete.

## Add five secrets

In [Cloudflare Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages), open **chandni-whatsapp-agent → Settings → Variables and Secrets → Add**. Select **Secret** for each item. Enter the exact name shown below, paste its value, then deploy the settings. Secret values are hidden after saving. Do not put any of them in Git, `wrangler.jsonc`, or chat.

| Secret name | Where to get its value |
|---|---|
| `META_VERIFY_TOKEN` | Make a new long random string in your password manager. Keep it there. You will enter the same string in Meta's **Verify token** field at cutover. |
| `META_APP_SECRET` | [Meta for Developers](https://developers.facebook.com/apps/) → app **wa-crm** (`1084450467911931`) → **App settings → Basic → App secret → Show**. |
| `META_ACCESS_TOKEN` | Reuse the working token in the n8n **Bearer Auth account** credential, or create a new non-expiring token under [Meta Business Settings](https://business.facebook.com/settings/) → **Users → System users → cli-bot → Generate new token**. Select app **wa-crm** and `whatsapp_business_messaging` plus `whatsapp_business_management`. Confirm `cli-bot` has full access to production WABA `2150197029173188` and phone number ID `1329088423615686`. Do not use a temporary WhatsApp Getting Started token or a similarly named test WABA. |
| `OPENAI_API_KEY` | [OpenAI API keys](https://platform.openai.com/api-keys) → create a new project key for this Worker. API billing is separate from ChatGPT. |
| `AGENT_ADMIN_KEY` | Make another long random string in your password manager. This is the password for the Worker's `/admin` inbox; use a different value from `META_VERIFY_TOKEN`. |

Cloudflare's [secret setup guide](https://developers.cloudflare.com/workers/configuration/secrets/) covers the dashboard flow. If a secret is lost, create a replacement and update it; the old value cannot be revealed from Cloudflare.

## Check before switching the live number

1. Open [health](https://chandni-whatsapp-agent.kinger-siddharth.workers.dev/health) and confirm `ok: true` and `database: connected`.
2. Open the [operator inbox](https://chandni-whatsapp-agent.kinger-siddharth.workers.dev/admin), enter `AGENT_ADMIN_KEY`, and confirm it connects. Keep this page monitored for handoffs and failed sends.
3. In the **wa-crm** app, open **WhatsApp → Configuration → Webhook**. At cutover, set **Callback URL** to `https://chandni-whatsapp-agent.kinger-siddharth.workers.dev/webhook` and **Verify token** to `META_VERIFY_TOKEN`. Verify and save. Ensure the `messages` field is subscribed.
4. Send `hi` to production WhatsApp number `+91 83201 29806` from a customer phone. Check that exactly one reply arrives and that the Worker inbox record is `done`. Then ask a specific design question to exercise OpenAI. Check a human request reaches `/admin`.
5. If no correct reply arrives, restore the prior n8n callback `https://b2bsuratfab.app.n8n.cloud/webhook/whatsapp-catalog-agent` immediately. Do not leave two reply handlers active.

Changing the callback is the final live switch. The first release can show priced designs, ask a clarification, record opt-outs, and put stock, delivery, order, human, or non-text requests into the operator inbox. It does not confirm an order or promise availability.
