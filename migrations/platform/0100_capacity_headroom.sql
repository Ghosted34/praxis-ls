-- ============================================================================
-- PLATFORM DB — 0100 Capacity headroom + pooler telemetry (WS-S1, WS-H1)
-- ============================================================================
--
-- WHAT WAS MISSING, PRECISELY
--
--   `tenant_health` already records `pool_waiting`, and `health-rollup` turns
--   `pool_waiting > 0` into RED. That is a correct signal and a useless warning:
--   requests only queue once the pool is ALREADY full, so the metric moves at
--   the moment of saturation, not before it. There was no measurement anywhere
--   that answers "how much room is left" — the question you need answered a week
--   before the answer becomes an incident.
--
--   Second gap: every connection figure recorded here is measured INSIDE this
--   process, against its own `pg` pools. WS-S1 puts PgBouncer in front of the
--   fleet, and at that point the app-side pool stops being the ceiling that
--   matters — the pooler's client/server connection counts are. Cutting over
--   without this would swap the architecture and keep watching the old one.
--
-- ── WHY UTILISATION IS STORED AND NOT COMPUTED ON READ ─────────────────────
--
--   `pool_max` is a per-tenant setting (`tenant_database.pool_max`, falling back
--   to TENANT_POOL_MAX) and it changes. A percentage computed at read time
--   against TODAY's ceiling would silently rewrite history: raise the cap and
--   last month's saturation quietly becomes last month's comfortable headroom.
--   Storing both the numerator and the denominator that were true at capture
--   time is the only version of this that can be trusted in hindsight.
--
-- ── WHY THE POOLER COLUMNS ARE NULLABLE AND ARRIVE EMPTY ───────────────────
--
--   Nothing routes through PgBouncer until TENANT_DB_POOLER_HOST is set, and
--   per D3's sequencing note that cutover waits on WS-S2's per-tenant roles
--   being backfilled. These columns therefore stay NULL on every deployment
--   that has not cut over, which is the honest representation: NULL means "not
--   measured", and zero would mean "measured, and idle" — the difference
--   between an unused pooler and a dead one.
--
--   They land NOW rather than at cutover so the collector, the console and the
--   alert thresholds are already in place when traffic moves. A cutover is a bad
--   time to discover the observability for it has not been written.
--
-- DOWN
-- Fully additive; all columns nullable, nothing references them.
-- ALTER TABLE platform.tenant_health
--   DROP COLUMN IF EXISTS pool_max,
--   DROP COLUMN IF EXISTS pool_utilisation_pct,
--   DROP COLUMN IF EXISTS pooler_cl_active,
--   DROP COLUMN IF EXISTS pooler_cl_waiting,
--   DROP COLUMN IF EXISTS pooler_sv_active,
--   DROP COLUMN IF EXISTS pooler_sv_idle,
--   DROP COLUMN IF EXISTS pooler_maxwait_us;

ALTER TABLE platform.tenant_health
  -- The denominator that was true when this row was captured. See above for why
  -- this is stored rather than resolved at read time.
  ADD COLUMN IF NOT EXISTS pool_max int,

  -- The leading indicator: in-use connections as a percentage of the ceiling.
  -- `pool_waiting` answers "are we over the edge"; this answers "how close".
  ADD COLUMN IF NOT EXISTS pool_utilisation_pct numeric(5,1),

  -- ── PgBouncer `SHOW POOLS` (NULL until cutover) ──────────────────────────
  -- cl_* are the APPLICATION's connections to the pooler; sv_* are the pooler's
  -- connections to Postgres. The gap between them is exactly what a pooler buys,
  -- and watching only one of the pair tells you nothing about whether it is
  -- working.
  ADD COLUMN IF NOT EXISTS pooler_cl_active int,

  -- The pooler-era equivalent of `pool_waiting`: clients holding on for a server
  -- connection. Non-zero here means the SERVER-side pool is the constraint.
  ADD COLUMN IF NOT EXISTS pooler_cl_waiting int,

  ADD COLUMN IF NOT EXISTS pooler_sv_active int,
  ADD COLUMN IF NOT EXISTS pooler_sv_idle int,

  -- Microseconds the longest-waiting client has been queued. PgBouncer reports
  -- this directly and it is the single best "about to hurt" number the pooler
  -- exposes: it rises before cl_waiting becomes sustained.
  ADD COLUMN IF NOT EXISTS pooler_maxwait_us bigint;

-- Finding the tenants nearest their ceiling is the query this whole migration
-- exists to make possible, and it wants the worst first. Partial, because rows
-- below the warning threshold are the overwhelming majority and are never the
-- ones being looked for.
CREATE INDEX IF NOT EXISTS ix_tenant_health_pressure
  ON platform.tenant_health (captured_at DESC, pool_utilisation_pct DESC)
  WHERE pool_utilisation_pct >= 60;

-- DOWN
-- DROP INDEX IF EXISTS platform.ix_tenant_health_pressure;
