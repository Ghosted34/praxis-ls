-- ============================================================================
-- PLATFORM DB — 0102 Sandbox wipe becomes MANUAL, and auditable
--
-- WHY THIS EXISTS (2026-08-22 incident). A tenant's sandbox was rebuilt at
-- 03:30 UTC and the data created hours earlier was gone, with nothing in the
-- console to say what had happened. Three separate defects lined up:
--
--   1. 0101 added `last_sandbox_wipe_at` as a bare nullable column with NO
--      backfill. The scheduler reads it as "never wiped → wipe now", so the
--      first tick after 0101 shipped wiped EVERY tenant's sandbox regardless
--      of its 14-day window. It then self-corrected (the worker stamps the
--      column), which is exactly why the event looked unexplainable rather
--      than periodic.
--   2. `sandbox_wipe_days` was `NOT NULL DEFAULT 14 CHECK (> 0)`, so the
--      scheduler's own documented opt-out ("0 or NULL keeps the sandbox
--      forever") could not be expressed. There was no way to say "never".
--   3. Nothing wrote an audit row. A DROP SCHEMA CASCADE was the only
--      destructive platform action with no entry in platform.platform_audit.
--
-- This migration closes 1 and 2. The audit row is application-side
-- (`provisioning.wipeSandbox` → action `sandbox.wiped`); the table it lands in
-- already exists and is already append-only (0030).
--
-- Policy decision recorded here: sandbox wipes are MANUAL from now on. The
-- scheduler is not deleted — it is switched off (SANDBOX_WIPE_CRON defaults to
-- empty) and every tenant is moved to `sandbox_wipe_days = 0`. A tenant that
-- wants a cadence back sets a positive number from the console, deliberately.
-- ============================================================================

-- 1. Backfill. Any tenant still carrying NULL would be wiped on the next tick
--    if the schedule were ever re-enabled. now() is the honest value: we do not
--    know when (or whether) their sandbox was last rebuilt, and "just now" is
--    the answer that cannot cause a surprise wipe.
UPDATE platform.tenant
   SET last_sandbox_wipe_at = now()
 WHERE last_sandbox_wipe_at IS NULL;

-- 2. Make "never" expressible. The old inline CHECK was created unnamed, so
--    Postgres named it tenant_sandbox_wipe_days_check; the replacement is named
--    explicitly so the next migration does not have to guess.
ALTER TABLE platform.tenant
  DROP CONSTRAINT IF EXISTS tenant_sandbox_wipe_days_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_sandbox_wipe_days_nonneg'
  ) THEN
    ALTER TABLE platform.tenant
      ADD CONSTRAINT tenant_sandbox_wipe_days_nonneg
      CHECK (sandbox_wipe_days >= 0);
  END IF;
END $$;

ALTER TABLE platform.tenant
  ALTER COLUMN sandbox_wipe_days SET DEFAULT 0;

-- 3. Every existing tenant → manual. This deliberately discards per-tenant
--    cadences: after the incident the safe default is that nothing destroys a
--    sandbox unless a person asked for it. Re-opting-in is one console field.
UPDATE platform.tenant
   SET sandbox_wipe_days = 0
 WHERE sandbox_wipe_days > 0;

COMMENT ON COLUMN platform.tenant.sandbox_wipe_days IS
  '0 = never auto-wipe (default; wipes are manual, from the console or the CLI). '
  '>0 = auto-wipe cadence in days, honoured by the sandbox-wipe-scheduler job. '
  'Every wipe, manual or scheduled, writes a platform_audit row (sandbox.wiped).';

COMMENT ON COLUMN platform.tenant.last_sandbox_wipe_at IS
  'Stamped by provisioning.wipeSandbox on every successful rebuild. NULL means '
  'never rebuilt AND is read by the scheduler as "due now" — never leave it NULL '
  'on an existing tenant.';

-- DOWN
--   ALTER TABLE platform.tenant DROP CONSTRAINT IF EXISTS tenant_sandbox_wipe_days_nonneg;
--   ALTER TABLE platform.tenant ALTER COLUMN sandbox_wipe_days SET DEFAULT 14;
--   -- The pre-0102 CHECK (> 0) cannot be restored while any tenant sits at 0;
--   -- set those tenants to 14 first if you genuinely want the old constraint:
--   --   UPDATE platform.tenant SET sandbox_wipe_days = 14 WHERE sandbox_wipe_days = 0;
--   --   ALTER TABLE platform.tenant ADD CONSTRAINT tenant_sandbox_wipe_days_check CHECK (sandbox_wipe_days > 0);
