ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES app_user(user_id);
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS work_status text NOT NULL DEFAULT 'OPEN';
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS first_response_due_at timestamptz;
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS resolution_due_at timestamptz;
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS first_responded_at timestamptz;
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS sla_breached_at timestamptz;

DO $$ BEGIN
  ALTER TABLE email_thread ADD CONSTRAINT ck_email_thread_work_status
    CHECK (work_status IN ('OPEN','PENDING','RESOLVED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS mail_sla_policy (
  mail_sla_policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email_connection_id uuid REFERENCES email_connection(email_connection_id) ON DELETE CASCADE,
  applies_to_vip boolean NOT NULL DEFAULT false,
  first_response_minutes integer NOT NULL,
  resolution_minutes     integer NOT NULL,
  business_hours_only    boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS business_hours (
  business_hours_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at time NOT NULL, closes_at time NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Douala'
);
CREATE TABLE IF NOT EXISTS business_holiday (
  business_holiday_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_on date NOT NULL UNIQUE, name text
);
CREATE TABLE IF NOT EXISTS email_thread_lock (
  email_thread_id uuid PRIMARY KEY REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_sla_policy_name_uq ON mail_sla_policy (name);
CREATE UNIQUE INDEX IF NOT EXISTS business_hours_dow_uq ON business_hours (day_of_week);

INSERT INTO mail_sla_policy (name, applies_to_vip, first_response_minutes, resolution_minutes)
VALUES ('Standard', false, 240, 2880)
ON CONFLICT (name) DO NOTHING;
INSERT INTO mail_sla_policy (name, applies_to_vip, first_response_minutes, resolution_minutes)
VALUES ('VIP', true, 60, 2880)
ON CONFLICT (name) DO NOTHING;

INSERT INTO business_hours (day_of_week, opens_at, closes_at, timezone)
VALUES
  (1, '08:00'::time, '17:00'::time, 'Africa/Douala'),
  (2, '08:00'::time, '17:00'::time, 'Africa/Douala'),
  (3, '08:00'::time, '17:00'::time, 'Africa/Douala'),
  (4, '08:00'::time, '17:00'::time, 'Africa/Douala'),
  (5, '08:00'::time, '17:00'::time, 'Africa/Douala')
ON CONFLICT (day_of_week) DO NOTHING;

INSERT INTO business_holiday (holiday_on, name) VALUES
  ('2026-01-01', 'New Year'),
  ('2026-05-01', 'Labour Day'),
  ('2026-05-20', 'National Day'),
  ('2026-12-25', 'Christmas')
ON CONFLICT (holiday_on) DO NOTHING;

-- DOWN
--   DROP TABLE IF EXISTS email_thread_lock, business_holiday, business_hours, mail_sla_policy;
