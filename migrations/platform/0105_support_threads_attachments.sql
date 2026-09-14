-- ============================================================================
-- PLATFORM DB — 0105 Support & Feedback: conversations, not status changes
--
-- A ticket used to end at a status change: the tenant raised it, Praxis moved
-- it New → Triaged → In Progress → Shipped, and the tenant saw the pill change.
-- The answer itself — "clear your browser cache, then export again" — had no
-- home. This gives it one: a reply thread on the ticket, image attachments on
-- the ticket and on every reply, on BOTH sides, so the tenant can show the
-- screen that is broken and Praxis can answer with a screenshot of its own.
--
-- ── MORE TICKET KINDS ────────────────────────────────────────────────────────
--
-- The CHECK list grew from three kinds to nine. `URGENT` exists as a KIND
-- (not a priority field) deliberately: the triage board is five fixed lanes by
-- STATUS, and a separate priority column would need a second filter and a
-- second sort order for a team that sorts "urgent first" by eyeballing the
-- list. A kind is one pill, one filter, one count. The original three keep
-- their values so nothing filed before this migration changes meaning.
--
-- ── REPLIES ─────────────────────────────────────────────────────────────────
--
-- `author_side` is a two-valued fact, not a user id: the two ends of this
-- conversation are TENANT (any user of the tenant, stamped with their email)
-- and PRAXIS (a platform user, stamped with their name/email in author_label).
-- A platform_user_id here would be a cross-database FK the platform DB cannot
-- enforce for a tenant email that may not match any app_user row.
--
-- `is_internal` is the Praxis-only note: "broker says red channel, don't tell
-- the tenant yet" — the same idea Q-tickets carries. The TENANT API strips it
-- server-side; a tenant reply can never set it (the tenant service does not
-- accept the flag at all), for the same reason a client cannot post an
-- internal note on a Q-ticket.
--
-- ── ATTACHMENTS ─────────────────────────────────────────────────────────────
--
-- Images only, by product decision: a bug report wants the SCREEN, and a
-- 10 MB screenshot compressed client-side is small enough that the platform
-- DB can point at object storage without its own blob table growing anything.
-- Bytes live in the shared object store (storage.service); this table is the
-- register — who attached what to which ticket/reply, with the mime so the
-- download endpoint serves the right Content-Type.
--
-- `ticket_id` and `reply_id` are both nullable because an upload lands BEFORE
-- its home: the tenant picks screenshots in the raise form before the ticket
-- exists, and Praxis attaches an image to a reply draft the same way. The
-- create/reply call links the ids it is handed; the upload path sweeps its own
-- tenant's unlinked rows older than six hours, so an abandoned form is the
-- only thing that costs storage and even that is reaped.
-- ============================================================================

-- More kinds. The original three values are untouched; the constraint is
-- dropped and re-added (it is an unnamed inline CHECK from 0030, which
-- Postgres named after the table and column). Guarded add, same shape as
-- 0104: `ADD CONSTRAINT` has no IF NOT EXISTS, and this file must survive
-- being run twice.
ALTER TABLE platform.support_ticket
  DROP CONSTRAINT IF EXISTS platform_support_ticket_kind_check;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t      ON t.oid = c.conrelid
      JOIN pg_namespace n  ON n.oid = t.relnamespace
     WHERE c.conname = 'platform_support_ticket_kind_check'
       AND t.relname = 'support_ticket'
       AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE platform.support_ticket
      ADD CONSTRAINT platform_support_ticket_kind_check
      CHECK (kind IN ('SUPPORT','BUG','FEATURE','BILLING','SECURITY','DATA','COMMS','URGENT','REQUEST'));
  END IF;
END $$;

-- The conversation.
CREATE TABLE IF NOT EXISTS platform.support_ticket_reply (
  reply_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    uuid NOT NULL REFERENCES platform.support_ticket(ticket_id) ON DELETE CASCADE,
  author_side  text NOT NULL CHECK (author_side IN ('TENANT','PRAXIS')),
  author_label citext,
  body         text NOT NULL,
  is_internal  boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_streply_ticket ON platform.support_ticket_reply(ticket_id, created_at);

-- The register of attached images (bytes in object storage, keyed by storage_key).
CREATE TABLE IF NOT EXISTS platform.support_attachment (
  attachment_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      uuid REFERENCES platform.support_ticket(ticket_id) ON DELETE CASCADE,
  reply_id       uuid REFERENCES platform.support_ticket_reply(reply_id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES platform.tenant(tenant_id) ON DELETE CASCADE,
  storage_key    text NOT NULL,
  file_name      text NOT NULL,
  mime_type      text NOT NULL,
  byte_size      bigint NOT NULL,
  created_by_email citext,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_stattach_ticket ON platform.support_attachment(ticket_id);
CREATE INDEX IF NOT EXISTS ix_stattach_reply ON platform.support_attachment(reply_id);
CREATE INDEX IF NOT EXISTS ix_stattach_orphan ON platform.support_attachment(created_at)
  WHERE ticket_id IS NULL;

-- DOWN
-- Additive and cleanly reversible: two new tables plus a widened CHECK. The
-- table drops cascade the child rows; the storage objects they pointed at
-- become orphans and are picked up by the next object-store sweep. Restoring
-- the CHECK to its original three kinds is safe only while no ticket has been
-- filed in a new kind — if any have, the honest answer is the pre-deploy dump.
--
-- DROP TABLE IF EXISTS platform.support_attachment;
-- DROP TABLE IF EXISTS platform.support_ticket_reply;
-- ALTER TABLE platform.support_ticket
--   DROP CONSTRAINT IF EXISTS platform_support_ticket_kind_check;
-- ALTER TABLE platform.support_ticket
--   ADD CONSTRAINT platform_support_ticket_kind_check
--   CHECK (kind IN ('SUPPORT','BUG','FEATURE'));
