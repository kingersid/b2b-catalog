# Order CRM and cloud terminal

Deployed on 1 October 2026. Open the [operator chat](https://chandni-whatsapp-agent.kinger-siddharth.workers.dev/admin/chat) and connect with `AGENT_ADMIN_KEY`.

## Order workflow

The [Chandni Orders database](https://app.notion.com/p/3f2e397a9e5f49f1b287f4e0f62f182e) is inside the supplied `chandni crm database` under `Chandni Orders workspace`. It uses the existing Notion OAuth connection; no additional Notion key is required. Connection identifiers are kept in authenticated D1 configuration and the database ID is also saved as a Worker secret.

1. From the owner number, send **Please note this order** with the party and city. Send marked photos and details, then **END ORDER**. Explicit order commands use deterministic capture; other owner messages use the operator assistant.
2. In **Orders and follow-ups**, enter the buyer's name, actual WhatsApp number with country code, products/quantities, outstanding amount, statuses and next action. Review and verify the details before saving.
3. The scheduled Worker synchronizes orders to Notion using `CSM-<order number>` and the original source message ID. It queries before creating and uses a lease to prevent concurrent creation. Failed synchronization preserves the D1 order for review.
4. Notion edits to customer, phone, products, payment/dispatch/order status, amount and next action are reconciled back to the CRM. Conflicting simultaneous edits stop synchronization and require review. Human Notion notes are preserved.
5. Pending payments prepare a WhatsApp follow-up action; overdue payments prepare a Sarvam action; paid orders prepare a dispatch checklist; dispatched orders prepare tracking confirmation actions. Changed order revisions supersede older drafts.
6. **Prepare for review** creates the provider draft. Review the recipient and exact content below the chat and explicitly confirm before sending a WhatsApp message or creating a campaign. This does not automatically start calls.

Recipient numbers are never taken from the owner sender. Unknown/missing facts remain visible for review. Opt-outs, invalid numbers and repeat preparations within 24 hours are blocked. Meta templates must be approved, and tracking confirmations need an actual carrier, tracking number and matching approved template.

The first Sarvam campaign remains limited to the owner test number `+91 95370 97267`. Customer calling is not enabled by this release. Record an actual result in **Record a verified call outcome** using the Sarvam call ID; the result goes to the order event history and Notion notes. There is no automatic Sarvam call-result webhook in this release.

Signed Meta delivery events update associated order history once per message/status, without inferring that a payment or dispatch occurred. The 9 AM Asia/Kolkata digest reports open orders, overdue payments, review items, due follow-ups and missing next actions. It sends ordinary text only when the owner has an open conversation window. Outside that window it remains available in the admin digest endpoint; an approved CRM digest template is needed for proactive delivery. The existing noon pending-order reminder remains separate.

Filtered Notion views are **Today**, **Payment pending**, **Overdue**, **Ready to dispatch**, **Needs review** and **Completed**. Today is refreshed to the India date by the scheduled job.

## Script workflow

Select Node.js or Python in **Cloud script terminal**, enter a script, choose **Review script**, then **Confirm and run**. The assistant can also prepare a script with `PREPARE_SCRIPT`; it cannot confirm execution itself.

- Separate Worker: `chandni-operator-terminal`, with no public route.
- SDK/image: `@cloudflare/sandbox` 0.12.10 and `docker.io/cloudflare/sandbox:0.12.10-python`. This pinned supported 0.x image avoids a local Docker build; do not update only one side.
- Only the authenticated operator service can invoke it. Sandbox ID is stable for the owner; the filesystem is isolated and cleared after each run.
- Script maximum: 8 KB. Child runtime: 20 seconds. Output: 16 KB total. Outer SDK timeout: 30 seconds. The supervisor stops the process group; final cleanup destroys the container, including remaining descendants.
- Internet is disabled and no Worker secrets, D1 bindings, Notion credentials, Meta credentials or Sarvam credentials enter the container. Scripts cannot perform production mutations; approved outbound actions remain in the operator flow.
- One script runs at a time. Confirmation is tied to the browser session, expires after 10 minutes and cannot run twice.
- D1 audits the script, runtime, time, execution state, exit code and bounded output. An uncertain execution is not retried automatically.

## Deployment and verification

Apply `wa-worker/crm.sql` to production D1 (safe to rerun), install pinned dependencies with `pnpm install --dir wa-worker`, deploy the terminal with `wrangler deploy --config wa-worker/terminal/wrangler.jsonc`, then deploy the agent with `wrangler deploy --config wa-worker/wrangler.jsonc`.

Automated checks cover source capture idempotency, status draft replacement, recipient validation, delivery deduplication, terminal session binding, confirmation deduplication and single-run concurrency, alongside the existing signed webhook, catalog privacy and outbound approval tests. Live arithmetic checks passed in both Node.js and Python; existing orders synchronized to the new Notion database. No customer reminder or call was sent as a deployment test. A new live owner WhatsApp order is still an operator acceptance check.
