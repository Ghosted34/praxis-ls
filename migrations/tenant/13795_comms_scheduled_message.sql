-- Durable chat scheduling. Message insertion and SENT transition share one
-- transaction; replay after a worker crash cannot duplicate a delivered message.
CREATE TABLE IF NOT EXISTS comms_scheduled_message (
  schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  group_id uuid NOT NULL REFERENCES comms_group(group_id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  reply_to uuid REFERENCES comms_message(message_id) ON DELETE SET NULL,
  send_at timestamptz NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','CANCELLED','FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  message_id uuid REFERENCES comms_message(message_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sender_user_id, request_id)
);
CREATE INDEX IF NOT EXISTS ix_comms_scheduled_due ON comms_scheduled_message(send_at, next_attempt_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS ix_comms_scheduled_owner ON comms_scheduled_message(sender_user_id, group_id, send_at);
-- VERIFY
-- SELECT to_regclass('comms_scheduled_message');
-- DOWN
-- DROP TABLE IF EXISTS comms_scheduled_message;
