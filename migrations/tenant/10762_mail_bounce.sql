CREATE TABLE IF NOT EXISTS email_bounce (
  email_bounce_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_message_id uuid REFERENCES email_message(email_message_id),
  original_message_id_header text,
  recipient   citext NOT NULL,
  bounce_type text NOT NULL CHECK (bounce_type IN ('HARD','SOFT','COMPLAINT','DELAY')),
  status_code text,
  diagnostic  text,
  reported_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE client_contact ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'OK';
ALTER TABLE supplier_contact ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'OK';
-- DOWN
--   DROP TABLE IF EXISTS email_bounce;
