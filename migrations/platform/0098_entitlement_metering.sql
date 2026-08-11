-- ============================================================================
-- PLATFORM DB — 0098 Entitlement & metering (INFRASTRUCTURE_PLAN §5, WS-S3)
-- ============================================================================
--
-- Feature gating today is binary: `feature_state` says a module is on or off,
-- and the rate limiter applies one flat ceiling per tenant. Nothing measures
-- CONSUMPTION against a plan — so "how many seats is this tenant actually
-- using", "are they over their AI budget", and "what should we invoice" are all
-- unanswerable, and a plan is a marketing document rather than a control.
--
-- This is the bridge from gating to billing, and per D5 it lands SPEND + SEATS
-- first (the data already exists) with storage and email following.
--
-- ── WHY TWO TABLES AND NOT A COLUMN ON `plan` ──────────────────────────────
--
--   Metrics are added over time — seats, then storage, then email, then
--   whatever the next plan sells. A column per metric means a migration every
--   time the commercial model moves, and a `plan` table that accretes nullable
--   numerics nobody can interpret. A row per (plan, metric) makes adding one a
--   data change.
--
-- ── WHY USAGE IS BUCKETED BY PERIOD ────────────────────────────────────────
--
--   Some metrics are a LEVEL (seats in use right now, gigabytes stored) and
--   some are a FLOW (AI spend this month, emails sent this month). Storing both
--   as (tenant, metric, period) lets one resolver read both: a level metric
--   simply overwrites the current period's row each time it is measured, while
--   a flow metric accumulates into it. Trying to store levels and flows in
--   different shapes would mean two resolvers and two console views that
--   disagree at month boundaries.
--
-- ── WHY `hard` IS PER ENTITLEMENT AND NOT PER METRIC ───────────────────────
--
--   The same metric is a hard stop on one plan and a warning on another —
--   that IS the commercial difference between tiers. Seats might be hard on
--   Starter and soft on Enterprise (where going over is a conversation, not a
--   lockout). So the flag belongs to the grant, not to the meter.
--
-- DOWN
-- Fully additive: two tables, nothing references them.
-- DROP TABLE IF EXISTS platform.tenant_usage;
-- DROP TABLE IF EXISTS platform.plan_entitlement;

CREATE TABLE IF NOT EXISTS platform.plan_entitlement (
  plan_id uuid NOT NULL REFERENCES platform.plan(plan_id) ON DELETE CASCADE,

  -- 'seats' | 'ai_spend_xaf' | 'storage_gb' | 'emails_month' | ...
  -- Deliberately text and not an enum: adding a metric must not require a
  -- migration to a type, and an unknown metric here is simply one no meter
  -- reports yet — inert, not broken.
  metric text NOT NULL,

  limit_value numeric NOT NULL CHECK (limit_value >= 0),

  -- false = soft: warn in the console and to the tenant, allow the action.
  -- true  = hard: block the specific action with ENTITLEMENT_EXCEEDED.
  hard boolean NOT NULL DEFAULT false,

  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, metric)
);


CREATE TABLE IF NOT EXISTS platform.tenant_usage (
  tenant_id uuid NOT NULL REFERENCES platform.tenant(tenant_id) ON DELETE CASCADE,
  metric text NOT NULL,

  -- Monthly bucket, always the FIRST of the month, so "this period" is a
  -- computed date rather than a range comparison on every read.
  period date NOT NULL,

  used numeric NOT NULL DEFAULT 0 CHECK (used >= 0),

  -- When the meter last ran. A usage figure with no timestamp cannot be
  -- distinguished from a meter that stopped reporting — and a seat count frozen
  -- at last Tuesday's value looks exactly like a tenant that stopped hiring.
  measured_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, metric, period)
);

-- The console roll-up and the billing export both read "everything for this
-- period", so the period leads.
CREATE INDEX IF NOT EXISTS ix_tenant_usage_period ON platform.tenant_usage (period DESC, metric);

-- ── Capability ─────────────────────────────────────────────────────────────
-- Reading usage is `plans.read` (it is plan data). Changing what a plan GRANTS
-- is a commercial act with revenue consequences, so it reuses `plans.write`
-- rather than inventing a tier — the people who set prices are the people who
-- set limits, and splitting them would put the two halves of one decision
-- behind two permissions.

-- DOWN
-- DROP INDEX IF EXISTS platform.ix_tenant_usage_period;
-- DROP TABLE IF EXISTS platform.tenant_usage;
-- DROP TABLE IF EXISTS platform.plan_entitlement;
