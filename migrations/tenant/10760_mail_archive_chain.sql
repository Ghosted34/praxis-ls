CREATE TABLE IF NOT EXISTS email_archive (
  email_archive_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_message_id uuid NOT NULL UNIQUE REFERENCES email_message(email_message_id),
  seq            bigint GENERATED ALWAYS AS IDENTITY,
  content_hash   text NOT NULL,
  prev_hash      text,
  chain_hash     text NOT NULL,
  attachment_hashes text[] NOT NULL DEFAULT '{}',
  archived_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_email_archive_seq ON email_archive (seq);
-- DOWN
--   DROP TABLE IF EXISTS email_archive;
