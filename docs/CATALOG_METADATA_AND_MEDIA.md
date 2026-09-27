# Catalog sales details and WhatsApp media

This feature branch adds an admin editor for verified product facts and inbound photo
and voice-note understanding. It is not deployed by committing this branch.

## Operator workflow

1. Open `/admin`, enter `UPLOAD_KEY`, and expand **Sales details** on a design.
2. Enter a clear product name, fabric, work/pattern, colours, use cases, composition,
   width, minimum metres, and buyer search words. Enter only facts verified by the team.
3. Set availability. **Sold out** products are excluded from Worker recommendations and
   the Meta feed. The existing **Hide design** control still removes a product from the
   public website as well.
4. Save the details. **Agent ready** means the design is active, positively priced,
   marked available, and has fabric, colours, and use cases filled in.

Real rates remain in `prices`; the metadata editor cannot set or expose rates to Kimi
or Meta. The Worker uses `design_id` to join sales facts to the active, priced catalog.
Unfilled legacy designs can still be shown, but the model is told that absent facts
are unknown. This keeps recommendations running while the catalog is tagged.

## Media behavior

- A customer photo is retrieved from Meta by media ID and sent to Kimi K2.6 with the
  current product facts. Kimi chooses up to three catalog IDs. Code validates IDs and
  sends a fixed, qualified introduction so photo-only visual guesses do not become
  customer-facing fabric or composition claims.
- A voice note is retrieved from Meta and transcribed by Cloudflare Workers AI
  `@cf/openai/whisper-large-v3-turbo`. The transcript follows the existing text
  decision path. A transcript alone does not unlock the B2B price gate; the buyer can
  confirm their business in text or a previously qualified conversation retains its
  status.
- Supported inbound images are JPEG and PNG, up to 5 MB. Supported voice media are
  OGG, MP4, MPEG, AMR, and AAC, up to 8 MB. Larger or failed media enters the
  existing review/retry path. Documents, video, and other media still go to a person.
- Raw customer media is processed in memory and is not stored in D1 or R2. D1 stores
  the media ID, type, and interpreted text for conversation context. Meta's retrieval
  URL is authenticated and short-lived.

## Rollout order

1. Back up production D1 and test the migrations against a local D1 copy.
2. Apply `migrations/2026-09-27-design-metadata.sql` and
   `migrations/2026-09-27-wa-media.sql` once to production D1. The media migration
   uses `ALTER TABLE`, so it is not repeatable.
3. Deploy the Pages catalog and Worker from this branch through the normal reviewed
   release process. The Worker has a new `AI` binding for transcription.
4. Tag several products in `/admin`, then test text, photo, and voice requests on an
   isolated WhatsApp test number before routing live traffic to the new Worker.
5. Confirm every recommendation uses an active, positively priced, non-sold-out ID,
   and verify the Meta feed still contains only its fixed `1 INR` placeholder.

The protected operator inbox still needs an unattended handoff alert. Until that is
added, a person must monitor `/admin` for media failures and hot leads.
