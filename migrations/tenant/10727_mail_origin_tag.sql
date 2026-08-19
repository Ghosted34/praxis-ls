-- ============================================================================
-- TENANT DB — 10727 Origin tagging: telling apart what we sent from what the
-- user sent on their phone.
--
-- ── THE QUESTION THIS ANSWERS ───────────────────────────────────────────────
--
-- An operator replies to a client from Praxis on Monday and from their phone on
-- Tuesday. Once the Sent folder is synced, both land in the workspace and look
-- identical. "Did this go out through the ERP?" then has no answer, and neither
-- does the more useful version of it: "which correspondence with this client
-- never made it onto the record?"
--
-- ── WHY THIS IS A FOUNDATION MIGRATION AND NOT A LATER ONE ──────────────────
--
-- The tag cannot be inferred afterwards. It has to be stamped INTO the message
-- at the moment we send it, as a header the mail server carries and hands back
-- when we re-read the message from the Sent folder. Every message sent before
-- the stamp exists is permanently unclassifiable, so every week this waits is a
-- week of mail that can only ever be UNKNOWN.
--
-- ── THE THREE STATES, AND WHY UNKNOWN IS ONE OF THEM ────────────────────────
--
--   PRAXIS    carries our X-Praxis-Origin header. We sent it.
--   EXTERNAL  an outbound message with no such header. Sent elsewhere.
--   UNKNOWN   predates the stamp, so neither claim is safe.
--
-- A system that confidently labels three years of historical mail "sent from
-- another device" is worse than one that admits it does not know. So the column
-- is nullable, the backfill sets UNKNOWN rather than guessing, and the UI shows
-- no badge at all for UNKNOWN rather than an ambiguous one.
--
-- ── message_id_header EARNS ITS KEEP TWICE ──────────────────────────────────
--
-- Generating our own RFC 5322 Message-ID and storing it is what makes the
-- reconciliation reliable — matching on subject and timestamp is guesswork.
-- The same column is what lets a bounce (which quotes the original Message-ID)
-- be tied back to the message that bounced, later in the programme.
--
-- NOTE FOR THE THREAD/MESSAGE REWORK: these four columns live on email_inbound
-- today. When that table is split into email_thread/email_message, the backfill
-- MUST carry all four across — losing origin_user_id in particular would make
-- every shared-mailbox send anonymous retroactively.
-- ============================================================================

ALTER TABLE email_inbound
  ADD COLUMN IF NOT EXISTS sent_via          text,
  ADD COLUMN IF NOT EXISTS message_id_header text,
  ADD COLUMN IF NOT EXISTS origin_user_id    uuid,
  ADD COLUMN IF NOT EXISTS origin_send_point text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_inbound_origin_user_fk') THEN
    ALTER TABLE email_inbound
      ADD CONSTRAINT email_inbound_origin_user_fk
      FOREIGN KEY (origin_user_id) REFERENCES app_user(user_id) ON DELETE SET NULL;
  END IF;
  ALTER TABLE email_inbound DROP CONSTRAINT IF EXISTS chk_email_inbound_sent_via;
  ALTER TABLE email_inbound ADD CONSTRAINT chk_email_inbound_sent_via
    CHECK (sent_via IS NULL OR sent_via IN ('PRAXIS','EXTERNAL','UNKNOWN'));
  -- An inbound message has no origin: it is not ours to attribute.
  ALTER TABLE email_inbound DROP CONSTRAINT IF EXISTS chk_email_inbound_origin_direction;
  ALTER TABLE email_inbound ADD CONSTRAINT chk_email_inbound_origin_direction
    CHECK (direction = 'OUT' OR (origin_user_id IS NULL AND origin_send_point IS NULL));
END $$;

-- Everything already outbound predates the stamp. Say so, rather than claiming
-- it was one or the other.
UPDATE email_inbound SET sent_via = 'UNKNOWN'
 WHERE direction = 'OUT' AND sent_via IS NULL;

CREATE INDEX IF NOT EXISTS ix_email_inbound_message_id
  ON email_inbound (message_id_header) WHERE message_id_header IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_email_inbound_sent_via
  ON email_inbound (sent_via) WHERE direction = 'OUT';
CREATE INDEX IF NOT EXISTS ix_email_inbound_origin_user
  ON email_inbound (origin_user_id) WHERE origin_user_id IS NOT NULL;

COMMENT ON COLUMN email_inbound.sent_via IS
  'For outbound only. PRAXIS = carried our X-Praxis-Origin header; EXTERNAL = sent from another client; UNKNOWN = predates origin tagging and must not be guessed at.';
COMMENT ON COLUMN email_inbound.origin_user_id IS
  'The human who pressed send, which is not the same as the From address when sending as a shared mailbox. This is what keeps a team address accountable.';

-- DOWN
--   DROP INDEX IF EXISTS ix_email_inbound_origin_user;
--   DROP INDEX IF EXISTS ix_email_inbound_sent_via;
--   DROP INDEX IF EXISTS ix_email_inbound_message_id;
--   ALTER TABLE email_inbound DROP CONSTRAINT IF EXISTS chk_email_inbound_origin_direction;
--   ALTER TABLE email_inbound DROP CONSTRAINT IF EXISTS chk_email_inbound_sent_via;
--   ALTER TABLE email_inbound DROP CONSTRAINT IF EXISTS email_inbound_origin_user_fk;
--   -- DESTRUCTIVE: drops the origin record. Messages sent while these columns
--   -- existed cannot be re-tagged afterwards — the header is on the mail server,
--   -- not in the database, and re-reading it means a full Sent-folder re-scan.
--   ALTER TABLE email_inbound
--     DROP COLUMN IF EXISTS origin_send_point,
--     DROP COLUMN IF EXISTS origin_user_id,
--     DROP COLUMN IF EXISTS message_id_header,
--     DROP COLUMN IF EXISTS sent_via;
