-- ============================================================================
-- TENANT DB — 0482 Email attachments. Binary lives in document_vault (never in a
-- row); this links an inbound message to its stored files. Mirrors comms_attachment
-- (0430). See doc/EMAIL_ENGINE_PLAN.md §3.2 / §6.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_attachment (
  email_attachment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_inbound_id  uuid NOT NULL REFERENCES email_inbound(email_inbound_id) ON DELETE CASCADE,
  vault_id          uuid REFERENCES document_vault(doc_id),
  filename          text,
  content_type      text,
  size_bytes        bigint,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_email_attachment_msg ON email_attachment(email_inbound_id);
