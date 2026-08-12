-- ============================================================================
-- PLATFORM DB — 0095 Kaizen ops (INFRASTRUCTURE_PLAN §3.1, §3.4, §3.5)
-- ============================================================================
--
-- WS-H1 fleet health rollup, WS-U1 uptime probing, WS-M1 maintenance windows.
-- One file because they land together and share one console surface; three
-- tables because they answer three different questions.
--
-- WHY tenant_health EXISTS WHEN health_sample (0093) ALREADY DOES
--
--   0093's `health_sample` is one row per collector tick for THE PLATFORM: is
--   the process up, can it reach Postgres and Redis. It cannot answer "is
--   tenant acme healthy", and that is the question §3.1 is about — the failure
--   mode where the process is fine, thirty-nine tenants are fine, and one
--   tenant's database is wedged. Fleet-wide metrics are structurally blind to
--   it: the platform looks up because it IS up.
--
--   So this is per-tenant grain, and it is a different table rather than a
--   `tenant_id` column on `health_sample` because the two have different
--   cadences, different retention, and different readers.
--
-- STATUS IS STORED, NOT DERIVED AT READ TIME
--
--   GREEN/AMBER/RED is computed by one function (health-rollup.service.js) and
--   written here. Storing it means the console and the alerting path cannot
--   disagree about what "RED" meant at 03:12, and that a rule change does not
--   silently rewrite history. Re-deriving on read would make yesterday's
--   incident change colour when someone edits a threshold.
--
-- DOWN
-- Fully additive: three tables, nothing references them.
-- DROP TABLE IF EXISTS platform.maintenance_window;
-- DROP TABLE IF EXISTS platform.uptime_sample;
-- DROP TABLE IF EXISTS platform.tenant_health;

-- ── WS-H1 / H2: per-tenant health time-series ───────────────────────────────

CREATE TABLE IF NOT EXISTS platform.tenant_health (
  tenant_id uuid NOT NULL REFERENCES platform.tenant(tenant_id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),

  -- From registry.poolStats(), per tenant DB.
  pool_total int, pool_idle int, pool_waiting int,
  -- From fleetSchemaStatus(). `schema_behind > 0` outside a deploy is drift.
  schema_behind int, schema_unreachable boolean NOT NULL DEFAULT false,
  jobs_failed_24h int,
  -- email_domain verification state, once WS-E5 lands. NULL = not applicable.
  mail_verified boolean,
  redis_ok boolean,

  -- WS-H2: the synthetic per-tenant read. This is the column that catches the
  -- "process up, one tenant's DB wedged" case — a real query through the
  -- tenant's own pool, not an inference from process-level metrics.
  liveness_ok boolean,
  liveness_ms int,

  last_error_at timestamptz,
  error_count_24h int,

  status text NOT NULL CHECK (status IN ('GREEN','AMBER','RED')),
  -- Why it is that colour, so an operator does not have to re-derive the rule
  -- from six nullable columns at three in the morning.
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,

  PRIMARY KEY (tenant_id, captured_at)
);

-- Every read is "this tenant, recent first" or "the whole fleet, latest".
CREATE INDEX IF NOT EXISTS ix_tenant_health_time ON platform.tenant_health (captured_at DESC);
-- The alerting query: who is not GREEN right now.
CREATE INDEX IF NOT EXISTS ix_tenant_health_bad
  ON platform.tenant_health (captured_at DESC) WHERE status <> 'GREEN';


-- ── WS-U1: external uptime probing ──────────────────────────────────────────
--
-- Per HOST, not per tenant: what is being measured is whether a URL answered,
-- and a tenant with two subdomains has two answers. `tenant_id` is nullable
-- because the platform/admin host belongs to no tenant.

CREATE TABLE IF NOT EXISTS platform.uptime_sample (
  sample_id bigserial PRIMARY KEY,
  host text NOT NULL,
  tenant_id uuid REFERENCES platform.tenant(tenant_id) ON DELETE CASCADE,
  probed_at timestamptz NOT NULL DEFAULT now(),

  up boolean NOT NULL,
  status_code int,
  -- NULL when the probe timed out: storing 0 would drag every latency average
  -- toward "fast" precisely when things are slow. Same reasoning as 0093.
  latency_ms int,
  error text
);

CREATE INDEX IF NOT EXISTS ix_uptime_host_time ON platform.uptime_sample (host, probed_at DESC);
CREATE INDEX IF NOT EXISTS ix_uptime_down ON platform.uptime_sample (probed_at DESC) WHERE NOT up;


-- ── WS-M1: maintenance windows ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform.maintenance_window (
  maintenance_window_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL = every tenant (a fleet-wide window, e.g. a schema migration).
  tenant_id uuid REFERENCES platform.tenant(tenant_id) ON DELETE CASCADE,

  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CONSTRAINT chk_window_order CHECK (ends_at > starts_at),

  title text NOT NULL,
  message text,
  -- ANNOUNCE shows a banner and nothing else; READ_ONLY additionally parks
  -- writes. Separate because most maintenance only needs the former, and a
  -- window that blocks writes when it did not need to is its own outage.
  mode text NOT NULL DEFAULT 'ANNOUNCE' CHECK (mode IN ('ANNOUNCE','READ_ONLY')),

  -- Set when an operator ends a window early; the window is then over
  -- regardless of ends_at. Nulling ends_at instead would lose the plan.
  cancelled_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The hot query, run on every request that renders a banner: "is there an
-- active window for this tenant right now". Partial on not-cancelled because a
-- cancelled window is never active.
CREATE INDEX IF NOT EXISTS ix_maintenance_active
  ON platform.maintenance_window (starts_at, ends_at)
  WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_maintenance_tenant
  ON platform.maintenance_window (tenant_id, starts_at DESC);

-- DOWN
-- DROP TABLE IF EXISTS platform.maintenance_window;
-- DROP TABLE IF EXISTS platform.uptime_sample;
-- DROP TABLE IF EXISTS platform.tenant_health;
