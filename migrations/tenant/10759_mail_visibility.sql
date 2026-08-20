ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'PRIVATE';
DO $$ BEGIN
  ALTER TABLE email_thread ADD CONSTRAINT ck_email_thread_visibility
    CHECK (visibility IN ('PRIVATE','TEAM','COMPANY'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS email_thread_share (
  email_thread_id uuid NOT NULL REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  granted_by uuid REFERENCES app_user(user_id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email_thread_id, user_id)
);
-- DOWN
--   DROP TABLE IF EXISTS email_thread_share;
--   ALTER TABLE email_thread DROP COLUMN IF EXISTS visibility;
