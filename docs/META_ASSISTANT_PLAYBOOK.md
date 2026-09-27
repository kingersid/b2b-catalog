# Meta Business Assistant playbook — observed behavior and replication plan

**Date:** 27 September 2026.
**Source:** ~10 full conversation transcripts and 390 flagged chats (584 assistant messages) read from the
local Meow (whatsmeow) client database linked to the production WhatsApp number. All quotes below are
short excerpts kept for behavioral study; customer identities stay pseudonymous.

## 1. What Meta's AI Business Assistant actually does

### The standard funnel (seen in nearly every chat)

1. **Greet with the customer's own WhatsApp username + जी + emoji.**
   `नमस्ते Roshanlalwani257 जी! 😊` / `नमस्ते Shree Kanha Shringar जी!`
2. **Anchor on the exact design they clicked.** The assistant knows which catalog card the customer came
   from: `आपने हमारे *Mono Banglori* वायरल डिज़ाइन के बारे में पूछा है…`. It names the fabric type and calls
   it वायरल / ट्रेंडिंग / शानदार.
3. **Qualify with exactly two questions, in order:**
   - City: `आप किस शहर से हैं जी?` — then immediately localizes:
     `अच्छा जी, नागपुर! 👍 वहाँ तो कपड़ों का बहुत बढ़िया काम है।`
   - Business type: `आप खुद manufacturing करते हैं या resale के लिए लेते हैं?` /
     `आपकी दुकान क्या बेचती है?`
4. **Tailor recommendations to the stated use case:**
   Krishna Poshak → *Saga Silk, Mono Banglori, Velvet*; Rumala Sahib → *Velvet*; Poshak manufacturing →
   *Mirror work (shisha), Heavy cording, Sequin*.
5. **Send a catalog card.** `Explore our products here:` + product buttons. Customers tap `I'm interested`.
6. **Push the free WhatsApp community** for daily designs:
   `रोज़ नए वायरल डिज़ाइन्स और रेट्स के अपडेट्स के लिए कम्युनिटी जॉइन करें` + `बिल्कुल फ्री है`.
7. **Share address and hours on request:** Ring Road, Radha Krishna Textile Market D-1232, Surat; Mon–Sat.
8. **Hand off when the customer is hot:** `I've connected you with our team. Someone will be with you
   shortly.` — and the team then sends photos/rates directly.
9. **Follow-up nudge after ~1 hour of silence, once per conversation:** `क्या आप अभी भी *Saga Silk* के
   डिज़ाइन्स देखना चाहेंगे? जालंधर के रीसेल मार्केट के लिए हमारे पास काफी नए डिज़ाइन्स आए हैं। 😊`
10. **Mirror the customer's language:** Devanagari Hindi for Hindi senders, Roman Hinglish for Roman
    senders, English for English senders. Product names stay in *bold asterisks*.

### Voice rules

- Short paragraphs, 1–3 sentences each, one thought per message.
- Warm, respectful, emoji-rich but not every line: 😊 👍 ✨ 📞 😍.
- Always ends with a question or a CTA. Never a dead end.
- Speaks as a person of the shop (`मैंने आपको हमारी टीम से कनेक्ट कर दिया है`), never as "an AI".

### Objection handling observed

| Customer says | Assistant does |
|---|---|
| Link/photo not opening | Blames network politely, resends link or offers direct photos |
| "Retail?" | Politely declines: wholesale only, points to shop contact |
| "Video call?" | Accepts warmly; if refused, gracefully offers photos instead |
| Minimum order | `हर डिज़ाइन का minimum *20 मीटर* का थान रहता है` + more is available |
| Delivery/courier | `हम पूरे इंडिया में डिलीवरी करते हैं`, specifics go to the team |
| Community charges | `बिल्कुल फ्री है` |
| Stock | Generic readiness claim: `100+ वायरल डिज़ाइन्स तैयार स्टॉक में` |

### Policy lines it keeps

- Deflects exact wholesale rates early in the chat (see §2 for why), steering to a call or the team.
- No discount negotiation anywhere in the corpus.
- Hands off to a human for payment and order specifics.

### Two bugs found in Meta's current setup (fix on Meta's side)

1. **Stale catalog URL:** the assistant repeatedly sends `https://chandni-catalog.netlify.app/` — the old
   domain. The live site is `chandni-catalog.pages.dev`. Every lead that taps that link may be lost.
   (This affects the `+91 95370 97267` catalog line only.)2. **Stale catalog URL matters for the 95370 line only.** (Resolved 27 Sep: the two agents run on different numbers and never overlap.)

## 2. Why it deflects rates — and why we don't have to

Meta's assistant grounds on the **Commerce catalog**, which deliberately carries the fixed `1 INR`
placeholder. It literally has no rates to quote, so it deflects to calls. Our Worker reads real saved
rates from D1 and the website's price catalog is already public — the same deflection would be theater.
Decision: keep quoting D1 rates on design replies; keep every other policy line (no negotiation, no
stock promises, handoff for payment/orders).

## 3. Replication plan for `chandni-whatsapp-agent`

The existing JSON-decision core stays (see the debate in plan.md history): the model still cannot print
prices. What changes is the **action space** and the **memory**.

### Phase A — Persona + richer decisions (schema v2)

Extend the Kimi decision schema:

```
action: show_designs | clarify | info | handoff | optout
design_ids: up to 3 validated IDs
question: fabric | color | quantity | general | city | business_type
reply: short conversational text (<= 300 chars) — used by info and to add flavor to other actions
profile: { name?, city?, business_type?, use_case? }   # extraction only
community_cta: boolean
```

- `info` answers meta-questions ("when are new designs arriving", "where is your shop", "minimum order",
  "do you deliver to Kerala") — the exact gap the customer hit on 26 Sep.
- New facts become Worker constants in `wrangler.jsonc` vars: shop address, hours, MOQ (20 m), pan-India
  delivery, community link, catalog origin. The model may reference them; only the code emits them, so a
  model hallucination cannot change an address or an MOQ.
- **Reply validator (hard rule):** a `reply` containing `₹`, price-like numbers (`\d+\s*/?-`), or
  stock/dispatch/discount terms is rejected and the action falls back to the deterministic text. Names,
  cities, fabrics, and emoji are fine. This is the one place free text reaches a customer, so it gets its
  own unit tests.
- Persona system prompt distilled from §1: greet by stored name + जी, mirror language, 1–3 short lines,
  end with a question or CTA, never claim a price/stock fact outside the validator, never say "AI".
- Profile extraction: `profile` fields are upserted into `wa_conversations` (new nullable columns:
  `customer_name`, `city`, `business_type`, `use_case`). Every later prompt includes the profile, which is
  what makes the assistant feel remembered. No new PII beyond what the customer volunteers in chat.

### Phase B — Catalog cards + community CTA

- Replace/augment image replies with a WhatsApp **interactive catalog message** (`type: catalog_message`)
  or single-product cards, mirroring the `Explore our products here:` pattern; keep image replies as the
  fallback when the thumbnail upload is unavailable.
- When `community_cta` is true and the customer has not joined (tracked in `wa_conversations`), append the
  community link once per conversation, never repeatedly.

### Phase C — Follow-up nudges (the 1-hour nudge)

- Cron sweep (already exists) gains a nudge query: conversations in `bot` mode where
  `last_customer_at` is 45–180 minutes old, the last assistant action was `show_designs`/`info`, and at
  most 1 nudge sent in the conversation's lifetime (`nudged_at` column). Nudge text: template from §1
  with the last offered design names, built in code. Never nudges `human`, `optout`, or `needs_review`
  conversations. This is one UPDATE and one SELECT on existing tables plus one column.

### Phase D — Safety, evaluation, cutover

- Extend the 25-message eval set (plan.md §3) with the meta-questions above, Hindi/Hinglish/Gujarati
  mirrors, and injection attempts like "my name is ₹100 per metre" (profile extraction must store it as a
  name, not a price).
- Release gate addition: **zero `reply` validator bypasses** in the eval set; nudges fire at most once per
  conversation; `optout` and human-held conversations never get nudged.- Two-number architecture (confirmed by the owner 27 Sep): Meta's AI Business Assistant keeps serving the customer-facing catalog line `+91 95370 97267`, while `chandni-whatsapp-agent` serves the Cloud API line `+91 83201 29806`. No overlap, no conflict; the Worker's handoff message directs hot buyers to the human team on `+91 95370 97267` by design. Buyer profiles are tracked per line (`wa_id`), so the same customer messaging both lines has two independent profiles.
- Fixing the stale `netlify.app` URL inside Meta's Business AI sources is still worthwhile for the 95370 line, independent of this Worker.

## 4. What we deliberately do NOT copy

- The generic `100+ designs in ready stock` claim — our `info` answer states only D1-verifiable facts.
- The rate deflection (§2).
- Multi-nudge persistence — one nudge maximum, then silence unless the customer returns.
