CREATE TABLE IF NOT EXISTS email_thread_summary (
  email_thread_id uuid PRIMARY KEY REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language IN ('en','fr')),
  summary text NOT NULL,
  message_count_at_generation integer NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  model text
);
-- DOWN
--   DROP TABLE IF EXISTS email_thread_summary;
