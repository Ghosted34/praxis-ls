-- ==============================================================================
-- TENANT DB — 11747 Resolution-SLA breach stamp (audit P5-1)
--
-- 10755 added `resolution_due_at` and the sweep has stamped it since the
-- clocks were wired. Nothing ever *read* it: only first-response breaches
-- notified, so a team could miss every resolution promise with a green queue.
--
-- `resolution_breached_at` is a SEPARATE stamp from `sla_breached_at` on
-- purpose. Reusing the first-response column would make a missed first reply
-- swallow the later resolution breach (the UPDATE is `…_at IS NULL`). The two
-- clocks are independent events and must fire independently.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. The sweep writes the stamp; nothing
-- else does.
-- ==============================================================================

ALTER TABLE email_thread
  ADD COLUMN IF NOT EXISTS resolution_breached_at timestamptz;

COMMENT ON COLUMN email_thread.resolution_breached_at IS
  'Set once by the SLA sweep when resolution_due_at has passed and the thread is still OPEN. Independent of sla_breached_at (first-response).';

-- DOWN
--   ALTER TABLE email_thread DROP COLUMN IF EXISTS resolution_breached_at;
