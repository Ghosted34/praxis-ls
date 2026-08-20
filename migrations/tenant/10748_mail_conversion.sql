-- ============================================================================
-- TENANT DB — 10748 Conversion link-back (PR-3). Bidirectional: the created
-- entity remembers the thread, the thread shows what it became.
-- ============================================================================

ALTER TABLE email_thread
  ADD COLUMN IF NOT EXISTS converted_entity_ref text;
ALTER TABLE email_thread
  ADD COLUMN IF NOT EXISTS converted_at timestamptz;
ALTER TABLE email_thread
  ADD COLUMN IF NOT EXISTS converted_by uuid REFERENCES app_user(user_id);

CREATE INDEX IF NOT EXISTS ix_email_thread_converted
  ON email_thread (converted_entity_ref) WHERE converted_entity_ref IS NOT NULL;

-- DOWN
--   ALTER TABLE email_thread DROP COLUMN IF EXISTS converted_entity_ref;
--   ALTER TABLE email_thread DROP COLUMN IF EXISTS converted_at;
--   ALTER TABLE email_thread DROP COLUMN IF EXISTS converted_by;
