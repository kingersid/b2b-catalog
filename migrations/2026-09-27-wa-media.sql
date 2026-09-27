-- Apply once to the existing production D1 before deploying the media Worker.
ALTER TABLE wa_inbox ADD COLUMN media_kind TEXT;
ALTER TABLE wa_inbox ADD COLUMN media_id TEXT;
ALTER TABLE wa_inbox ADD COLUMN media_mime TEXT;
ALTER TABLE wa_inbox ADD COLUMN interpreted_text TEXT;
