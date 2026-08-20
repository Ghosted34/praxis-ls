-- ============================================================================
-- TENANT DB — 10737 Attachments in both directions, and inline images.
--
-- ── THE COLUMN NAME WAS A LIE AFTER 10731 ───────────────────────────────────
--
-- `email_attachment.email_inbound_id` stopped meaning what it says the moment
-- PR-1A re-pointed its foreign key at `email_message`. The ids were identical so
-- no row moved and nothing broke, but every join written from here on would read
-- as though it touched the legacy table. Renamed to `email_message_id` now,
-- while there are six call sites, rather than in a year when there are sixty.
--
-- ── WHY A DRAFT OWNS ATTACHMENTS BEFORE A MESSAGE EXISTS ────────────────────
--
-- Someone attaches a 4 MB bill of lading, writes for ten minutes, then sends.
-- The bytes have to live somewhere for those ten minutes, and they have to be
-- reachable if the tab is closed and the draft reopened on another machine. So
-- an attachment row may point at a DRAFT or at a MESSAGE, exactly one of the
-- two, and sending re-points it. The CHECK constraint is what stops a third
-- state existing — an attachment belonging to neither is an orphan holding vault
-- bytes nobody can find or delete.
--
-- ── INLINE IMAGES ARE `cid:` PARTS, NOT BASE64 ──────────────────────────────
--
-- A pasted screenshot inlined as base64 inflates the HTML part past Gmail's
-- 102 KB clip threshold almost immediately, and a clipped message hides the rest
-- behind "View entire message" — which silently truncates the quotation the
-- recipient needed. `content_id` plus `disposition = 'inline'` is the RFC 2392
-- answer, and it is what every real mail client sends.
-- ============================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'email_attachment'
                AND column_name = 'email_inbound_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = current_schema() AND table_name = 'email_attachment'
                        AND column_name = 'email_message_id') THEN
    ALTER TABLE email_attachment RENAME COLUMN email_inbound_id TO email_message_id;
  END IF;
END $$;

-- A stored attachment now belongs to a draft OR a message. Nullable so the swap
-- on send is one UPDATE rather than a delete and re-insert that would lose the
-- vault reference in between.
ALTER TABLE email_attachment ALTER COLUMN email_message_id DROP NOT NULL;
ALTER TABLE email_attachment ADD COLUMN IF NOT EXISTS email_draft_id uuid;
ALTER TABLE email_attachment ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'IN'
  CHECK (direction IN ('IN', 'OUT'));
ALTER TABLE email_attachment ADD COLUMN IF NOT EXISTS disposition text NOT NULL DEFAULT 'attachment'
  CHECK (disposition IN ('attachment', 'inline'));
-- RFC 2392: the value a `cid:` URL in the HTML part resolves against. Null for a
-- plain attachment; set, and unique within its owner, for an inline image.
ALTER TABLE email_attachment ADD COLUMN IF NOT EXISTS content_id text;
ALTER TABLE email_attachment ADD COLUMN IF NOT EXISTS checksum_sha256 text;
ALTER TABLE email_attachment ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL;

-- Exactly one owner. An attachment belonging to neither is an orphan holding
-- vault bytes nobody can find; one belonging to both would be sent twice.
DO $$ BEGIN
  ALTER TABLE email_attachment DROP CONSTRAINT IF EXISTS ck_email_attachment_one_owner;
  ALTER TABLE email_attachment ADD CONSTRAINT ck_email_attachment_one_owner
    CHECK (num_nonnulls(email_message_id, email_draft_id) = 1);
EXCEPTION WHEN check_violation THEN
  -- An existing row with neither owner predates this constraint and cannot be
  -- repaired here — leave the table unconstrained rather than failing the
  -- migration, and let check-schema-drift surface it.
  RAISE NOTICE 'email_attachment has rows with no owner; one-owner constraint not applied';
END $$;

CREATE INDEX IF NOT EXISTS ix_email_attachment_draft ON email_attachment(email_draft_id)
  WHERE email_draft_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_attachment_cid_message
  ON email_attachment(email_message_id, content_id)
  WHERE content_id IS NOT NULL AND email_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_attachment_cid_draft
  ON email_attachment(email_draft_id, content_id)
  WHERE content_id IS NOT NULL AND email_draft_id IS NOT NULL;

-- Everything already stored arrived on an inbound message.
UPDATE email_attachment SET direction = 'IN' WHERE direction IS NULL;

COMMENT ON COLUMN email_attachment.content_id IS
  'RFC 2392 Content-ID for an inline image, without the angle brackets. The HTML part references it as cid:<value>. Null for an ordinary attachment.';
COMMENT ON CONSTRAINT ck_email_attachment_one_owner ON email_attachment IS
  'A stored attachment belongs to a draft OR a sent/received message, never both and never neither. Sending re-points it from the draft to the message in one UPDATE.';

-- DOWN
--   DROP INDEX IF EXISTS ux_email_attachment_cid_draft;
--   DROP INDEX IF EXISTS ux_email_attachment_cid_message;
--   DROP INDEX IF EXISTS ix_email_attachment_draft;
--   ALTER TABLE email_attachment DROP CONSTRAINT IF EXISTS ck_email_attachment_one_owner;
--   -- DESTRUCTIVE: drops the columns that distinguish an outbound or inline
--   -- attachment from an inbound one. Inbound rows are unaffected; unsent draft
--   -- attachments become unreachable and their vault bytes orphaned.
--   ALTER TABLE email_attachment DROP COLUMN IF EXISTS created_by;
--   ALTER TABLE email_attachment DROP COLUMN IF EXISTS checksum_sha256;
--   ALTER TABLE email_attachment DROP COLUMN IF EXISTS content_id;
--   ALTER TABLE email_attachment DROP COLUMN IF EXISTS disposition;
--   ALTER TABLE email_attachment DROP COLUMN IF EXISTS direction;
--   ALTER TABLE email_attachment DROP COLUMN IF EXISTS email_draft_id;
--   ALTER TABLE email_attachment RENAME COLUMN email_message_id TO email_inbound_id;
