-- ============================================================================
-- TENANT DB — 10746 Internal notes + reusable mention primitive (PR-3).
-- Notes live in a different table from email_message. They cannot be sent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_thread_note (
  email_thread_note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_thread_id  uuid NOT NULL REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  author_user_id   uuid NOT NULL REFERENCES app_user(user_id),
  body             text NOT NULL,
  body_json        jsonb,
  reply_to_note_id uuid REFERENCES email_thread_note(email_thread_note_id),
  edited_at        timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_email_thread_note_thread
  ON email_thread_note (email_thread_id, created_at);

CREATE TABLE IF NOT EXISTS mention (
  mention_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind      text NOT NULL CHECK (source_kind IN ('MAIL_NOTE','CHAT_MESSAGE','DOSSIER_NOTE')),
  source_ref       text NOT NULL,
  context_ref      text,
  mentioned_user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  author_user_id   uuid NOT NULL REFERENCES app_user(user_id),
  excerpt          text,
  is_read          boolean NOT NULL DEFAULT false,
  acknowledged_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mention_inbox ON mention(mentioned_user_id, is_read, created_at DESC);

-- DOWN
--   DROP TABLE IF EXISTS mention;
--   DROP TABLE IF EXISTS email_thread_note;
