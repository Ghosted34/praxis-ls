-- ============================================================================
-- TENANT DB — 10728 Send throttling, sync depth, and the counters behind them.
--
-- ── WHY A THROTTLE IS NOT OPTIONAL ON cPanel ────────────────────────────────
--
-- The first tenant sends through cPanel, and shared cPanel hosting caps outbound
-- mail per domain per hour — commonly 200 to 500. Exceeding it does not queue
-- the overflow; it SUSPENDS the mailbox. A month-end invoice run plus a
-- notification fan-out can cross that line in minutes, and the failure mode is
-- the company's email going dark, not a few messages arriving late.
--
-- So sending is metered here, and the meter is per connection because the limit
-- belongs to the mailbox's own host, not to Praxis.
--
-- ── SPILLOVER, NOT FAILURE ──────────────────────────────────────────────────
--
-- When a send would cross the cap it is held for the next window and the sender
-- is told: "3 messages queued, sending from 14:00". That is a normal state with
-- an honest label, and it is the difference between an invoice run that takes
-- two hours and an invoice run that gets the mail server suspended. Failing the
-- send instead would push people to send from Outlook, which defeats the point.
--
-- ── WHY SYNC DEPTH IS A LIMIT TOO ───────────────────────────────────────────
--
-- First sync of a ten-year mailbox with no floor pulls every attachment into the
-- document vault overnight. 90 days is the default; importing the full history
-- is a deliberate action with progress, not something that happens because
-- somebody connected a mailbox at 17:00 on a Friday.
--
-- NULL on any limit column means "use the tenant default", which lives in the
-- `mail` settings section. That is the same absent-means-inherit convention the
-- user_preference table already uses, and it means changing the tenant default
-- actually moves the mailboxes that never overrode it.
-- ============================================================================

ALTER TABLE email_connection
  ADD COLUMN IF NOT EXISTS send_limit_hourly integer,
  ADD COLUMN IF NOT EXISTS send_limit_daily  integer,
  ADD COLUMN IF NOT EXISTS sync_depth_days   integer,
  ADD COLUMN IF NOT EXISTS history_imported_at timestamptz;

DO $$ BEGIN
  ALTER TABLE email_connection DROP CONSTRAINT IF EXISTS chk_email_connection_limits_positive;
  ALTER TABLE email_connection ADD CONSTRAINT chk_email_connection_limits_positive
    CHECK ((send_limit_hourly IS NULL OR send_limit_hourly > 0)
       AND (send_limit_daily  IS NULL OR send_limit_daily  > 0)
       AND (sync_depth_days   IS NULL OR sync_depth_days  >= 0));
END $$;

-- One row per mailbox per hour. The hour is the window; the daily figure is the
-- sum of the last 24 rows, so there is one counter to keep correct instead of
-- two that can disagree.
CREATE TABLE IF NOT EXISTS email_send_window (
  email_connection_id uuid NOT NULL REFERENCES email_connection(email_connection_id) ON DELETE CASCADE,
  window_start        timestamptz NOT NULL,     -- date_trunc('hour', ...)
  sent_count          integer NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email_connection_id, window_start)
);
CREATE INDEX IF NOT EXISTS ix_email_send_window_recent
  ON email_send_window (window_start DESC);

COMMENT ON TABLE email_send_window IS
  'Outbound counter per mailbox per hour, used to hold a send that would cross the host''s rate limit rather than let the host suspend the mailbox. Rows older than 48h are swept; they are a counter, not a log — email_send_log is the log.';
COMMENT ON COLUMN email_connection.sync_depth_days IS
  'How far back the first sync reaches. NULL inherits the tenant default (90). 0 means no historical import at all — only mail arriving from now on.';
COMMENT ON COLUMN email_connection.history_imported_at IS
  'Set when someone deliberately imports the full history past sync_depth_days, so the action is visible and not repeated by accident.';

-- DOWN
--   DROP INDEX IF EXISTS ix_email_send_window_recent;
--   DROP TABLE IF EXISTS email_send_window;
--   ALTER TABLE email_connection DROP CONSTRAINT IF EXISTS chk_email_connection_limits_positive;
--   -- DESTRUCTIVE: drops per-mailbox throttle overrides. Sending reverts to
--   -- unmetered, which on a shared cPanel host risks suspension under load.
--   ALTER TABLE email_connection
--     DROP COLUMN IF EXISTS history_imported_at,
--     DROP COLUMN IF EXISTS sync_depth_days,
--     DROP COLUMN IF EXISTS send_limit_daily,
--     DROP COLUMN IF EXISTS send_limit_hourly;
