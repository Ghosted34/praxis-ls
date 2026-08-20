CREATE TABLE IF NOT EXISTS email_followup (
  email_followup_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_thread_id uuid NOT NULL REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('SNOOZE','NO_REPLY','SEQUENCE_STEP')),
  due_at       timestamptz NOT NULL,
  cancel_on_reply boolean NOT NULL DEFAULT true,
  note         text,
  sequence_id  uuid,  step_index integer,
  status       text NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','FIRED','CANCELLED')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_email_followup_due ON email_followup(due_at) WHERE status='PENDING';
-- DOWN
--   DROP TABLE IF EXISTS email_followup;
