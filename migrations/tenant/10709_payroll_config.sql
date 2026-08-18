-- ============================================================================
-- TENANT DB — 10709 Payroll rate configuration, effective-dated (G18)
--
-- The legacy read the rate table via get_master_config($conn, $targetDate) —
-- "the most recent config effective on or before the target date" — from
-- payroll_config_history (effective_date, config_json, created_by), and a
-- rate change was a one-afternoon admin task that kept re-runs of past months
-- honest. The rebuild hard-coded DEFAULTS in payroll.rules.js and let each
-- compute accept a config from the request body: two people computing the
-- same run with different bodies got different payslips, both authoritative.
--
-- This restores the effective-dated source of truth. A change to a statutory
-- rate is a saved config row, not a redeploy; compute resolves the config
-- effective for the run's period; the snapshot on the run keeps past periods
-- honest.
-- ============================================================================

CREATE TABLE IF NOT EXISTS payroll_config (
  payroll_config_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES corporate_entity(entity_id) ON DELETE CASCADE,
  effective_date    date NOT NULL,
  config            jsonb NOT NULL,
  created_by        uuid REFERENCES app_user(user_id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, effective_date)
);

CREATE INDEX IF NOT EXISTS ix_payroll_config_entity
  ON payroll_config(entity_id, effective_date DESC);

-- DOWN
--   DROP TABLE IF EXISTS payroll_config;
