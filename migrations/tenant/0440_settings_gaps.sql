-- ============================================================================
-- TENANT DB — 0440 settings gap-fixes (Pixie parity, single-business-per-tenant).
--   - notification_preference : per-user channel/category opt-out (GAP §1.2)
--   - scheduled_report        : tenant-defined recurring report runs (GAP §1.3)
-- See doc/GAP_FIXES_PLAN.md. Applied idempotently by services/platform/migrator.js
-- (tracked in public.schema_migration), so existing tenants upgrade in place.
-- ============================================================================

-- Per-user notification preferences. Absence of a row = enabled (opt-out model),
-- so this table only ever stores explicit opt-outs/overrides. Channels mirror
-- the `notification` table's own CHECK so a preference can't reference a channel
-- the fan-out can't deliver on.
CREATE TABLE IF NOT EXISTS notification_preference (
  user_id     uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('IN_APP','EMAIL','SMS','WHATSAPP')),
  category    text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel, category)
);

-- Tenant-defined recurring reports. A worker scans due rows (active AND
-- next_run_at <= now) and generates/delivers via the existing report producers
-- (MOD-63). report_key must be one the reporting catalogue knows (enforced in
-- the service, not the DB, since the catalogue lives in code).
CREATE TABLE IF NOT EXISTS scheduled_report (
  scheduled_report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  report_key   text NOT NULL,
  params       jsonb NOT NULL DEFAULT '{}'::jsonb,
  cadence      text NOT NULL CHECK (cadence IN ('daily','weekly','monthly','quarterly','on_event')),
  recipients   text[] NOT NULL DEFAULT '{}',
  formats      text[] NOT NULL DEFAULT ARRAY['pdf'],
  active       boolean NOT NULL DEFAULT true,
  next_run_at  timestamptz,
  last_run_at  timestamptz,
  created_by   uuid REFERENCES app_user(user_id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Hot path for the due-scan: only active rows, ordered by when they're due.
CREATE INDEX IF NOT EXISTS scheduled_report_due_idx
  ON scheduled_report (next_run_at) WHERE active;
