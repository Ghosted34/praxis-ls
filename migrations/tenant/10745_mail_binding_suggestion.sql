-- ============================================================================
-- TENANT DB — 10745 Binding suggestions (PR-3). Q18: suggest only.
-- email_thread.entity_ref is set ONLY when a human accepts (or binds manually).
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_binding_suggestion (
  email_binding_suggestion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_thread_id  uuid NOT NULL REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  email_message_id uuid REFERENCES email_message(email_message_id) ON DELETE CASCADE,
  entity_ref       text NOT NULL,
  entity_label     text,
  signal           text NOT NULL CHECK (signal IN
                     ('DOSSIER_REF','INVOICE_REF','PO_REF','QUOTE_REF','CONTAINER_NO','BL_AWB_NO',
                      'SENDER_ADDRESS','SENDER_DOMAIN','THREAD_HISTORY')),
  matched_text     text,
  confidence       numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status           text NOT NULL DEFAULT 'SUGGESTED'
                     CHECK (status IN ('SUGGESTED','ACCEPTED','REJECTED','SUPERSEDED')),
  decided_by       uuid REFERENCES app_user(user_id),
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email_thread_id, entity_ref, signal)
);
CREATE INDEX IF NOT EXISTS ix_binding_open ON email_binding_suggestion(email_thread_id)
  WHERE status = 'SUGGESTED';

INSERT INTO setting (section, key, value) VALUES
  ('mail', 'binding', '{"auto_accept_threshold": null}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- DOWN
--   DROP TABLE IF EXISTS email_binding_suggestion;
--   DELETE FROM setting WHERE section='mail' AND key='binding';
