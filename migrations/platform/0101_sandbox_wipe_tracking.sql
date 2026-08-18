-- ============================================================================
-- PLATFORM DB — 0101 Sandbox auto-wipe tracking (G3, PRD §5.5)
--
-- The wipe cron (sandbox-wipe-scheduler) must know when each tenant's sandbox
-- was last rebuilt so it can honour `tenant.sandbox_wipe_days` (default 14)
-- instead of wiping every day. One column on the existing tenant row; the
-- scheduler reads it, the wipe worker stamps it.
-- ============================================================================

ALTER TABLE platform.tenant
  ADD COLUMN IF NOT EXISTS last_sandbox_wipe_at timestamptz;

-- DOWN
--   ALTER TABLE platform.tenant DROP COLUMN IF EXISTS last_sandbox_wipe_at;
