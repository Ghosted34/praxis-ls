-- ============================================================================
-- TENANT DB — 0481 Enrich email_inbound (stub from 0451) for the real intake.
-- Adds the connection link, the provider message id, threading, direction, full
-- bodies, and the dedup guard. See doc/EMAIL_ENGINE_PLAN.md §3.2 / §5.
-- ============================================================================

ALTER TABLE email_inbound ADD COLUMN IF NOT EXISTS email_connection_id uuid
  REFERENCES email_connection(email_connection_id);
ALTER TABLE email_inbound ADD COLUMN IF NOT EXISTS external_message_id text;
ALTER TABLE email_inbound ADD COLUMN IF NOT EXISTS thread_key text;
ALTER TABLE email_inbound ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'IN'
  CHECK (direction IN ('IN','OUT'));
ALTER TABLE email_inbound ADD COLUMN IF NOT EXISTS body_html text;
ALTER TABLE email_inbound ADD COLUMN IF NOT EXISTS body_text text;
ALTER TABLE email_inbound ADD COLUMN IF NOT EXISTS in_reply_to text;

-- Dedup: webhooks AND polling can both deliver the same message. Scoped to the
-- connection so two mailboxes can legitimately hold the same provider id.
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_inbound_dedup
  ON email_inbound(email_connection_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_email_inbound_thread ON email_inbound(thread_key);
CREATE INDEX IF NOT EXISTS ix_email_inbound_conn   ON email_inbound(email_connection_id, received_at DESC);
