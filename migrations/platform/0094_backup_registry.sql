-- ============================================================================
-- PLATFORM DB — 0094 Backup registry (INFRASTRUCTURE_PLAN §3.2, WS-B1 / WS-B3)
-- ============================================================================
--
-- Database-per-tenant makes per-tenant backup simple IN PRINCIPLE and is the
-- strongest argument for the tenancy model. In practice, until this migration,
-- backups were neither scheduled centrally nor ever rehearsed — which means
-- there were no backups, only an intention to have some. A dump nobody has
-- restored is not a recovery plan; it is an untested assertion about a file.
--
-- These two tables are what turn that intention into something falsifiable.
-- `backup_run` records every attempt (including the failures, which are the
-- interesting ones), so "when did this tenant last have a good backup" is a
-- query rather than an inference from bucket listings. `restore_drill` records
-- every rehearsal and the MEASURED time to restore, so the RTO target ratified
-- in D4 is checked against reality on a schedule instead of being a number in a
-- document.
--
-- WHY FAILURES ARE ROWS AND NOT JUST LOGS
--
--   The failure mode this protects against is silence. A backup job that stops
--   running produces no log line to notice the absence of, and a bucket that
--   stops receiving dumps looks exactly like a bucket nobody has checked. By
--   writing a row per attempt — OK or FAILED — staleness becomes detectable as
--   "no OK row for tenant X in 48h", which is a condition an alert can hold.
--
-- GRAIN
--
--   backup_run: one row per (tenant, kind, attempt). `tenant_id` is NULL for
--   fleet-wide artefacts — WAL archiving and the object-storage sync are not
--   per-tenant, and forcing them into a per-tenant shape would either duplicate
--   a row per tenant or invent a sentinel tenant.
--
--   restore_drill: one row per rehearsal. Nullable `tenant_id` for the same
--   reason plus one more — a drill against a cluster-level PITR restore is not
--   about one tenant.
--
-- RETENTION
--
--   Deliberately none in this migration. These tables are tiny (one row per
--   tenant per night) and their whole value is the long view: "have we ever
--   successfully restored this tenant" is a question about history. Revisit if
--   the fleet reaches a scale where nightly × tenants × years matters, which is
--   several orders of magnitude away.
--
-- DOWN
-- Fully additive: two new tables, nothing references them.
-- DROP TABLE IF EXISTS platform.restore_drill;
-- DROP TABLE IF EXISTS platform.backup_run;

CREATE TABLE IF NOT EXISTS platform.backup_run (
  backup_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL = a fleet/cluster artefact (WAL segment, object-storage sync) rather
  -- than one tenant's dump. ON DELETE CASCADE would destroy the record that a
  -- deprovisioned tenant was ever backed up, which is exactly the record you
  -- want when someone asks to restore them; SET NULL keeps the history.
  tenant_id uuid REFERENCES platform.tenant(tenant_id) ON DELETE SET NULL,
  -- Denormalised so a run stays attributable after the tenant row is gone.
  slug text,

  kind text NOT NULL CHECK (kind IN ('PG_DUMP','WAL','OBJECT_SYNC','SNAPSHOT_SCAN')),
  status text NOT NULL CHECK (status IN ('OK','FAILED')),

  bytes bigint,
  -- Driver-qualified location, e.g. 'local:pg/acme/2026-08-10T02.dump' or
  -- 's3://praxis-backups/pg/acme/2026-08-10T02.dump'. Driver-independent on
  -- purpose: a stored location keeps meaning after BACKUP_DRIVER changes.
  location text,
  -- SHA-256 of the artefact as written. WS-B4's integrity scan compares against
  -- this; a restore drill can also confirm it read back what was stored.
  checksum text,

  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- Generated rather than written by the app: duration is a property of the two
  -- timestamps, and a column the app computes is a column the app can get wrong.
  duration_ms integer GENERATED ALWAYS AS (
    (EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000)::integer
  ) STORED,

  error text
);

-- The staleness query: "latest OK PG_DUMP per tenant". Partial, because the
-- failures are read by a different (much rarer) query and would otherwise bloat
-- the index every backup cycle.
CREATE INDEX IF NOT EXISTS ix_backup_run_tenant_ok
  ON platform.backup_run (tenant_id, started_at DESC)
  WHERE status = 'OK';

-- The alerting query: recent failures across the fleet, newest first.
CREATE INDEX IF NOT EXISTS ix_backup_run_failed
  ON platform.backup_run (started_at DESC)
  WHERE status = 'FAILED';

CREATE INDEX IF NOT EXISTS ix_backup_run_kind_time ON platform.backup_run (kind, started_at DESC);


CREATE TABLE IF NOT EXISTS platform.restore_drill (
  restore_drill_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  tenant_id uuid REFERENCES platform.tenant(tenant_id) ON DELETE SET NULL,
  slug text,

  -- Which backup was exercised, so a failed drill points at a specific artefact
  -- rather than at "the backups".
  backup_run_id uuid REFERENCES platform.backup_run(backup_run_id) ON DELETE SET NULL,
  -- The dump timestamp or PITR target the drill restored TO.
  restored_to timestamptz,

  -- The measured RTO. This is the number D4's "RTO ≤ 1h per tenant" is checked
  -- against — measured on real data, not estimated.
  rto_seconds integer,
  ok boolean NOT NULL,
  -- Per-probe results: row counts vs source, core table reads, trial-balance
  -- recompute, vault-hash spot check. jsonb because the probe set will grow and
  -- a column per probe would mean a migration every time it does.
  checks_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,

  ran_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_restore_drill_tenant_time ON platform.restore_drill (tenant_id, ran_at DESC);
-- "Show me the failed drills" — the query that should page someone.
CREATE INDEX IF NOT EXISTS ix_restore_drill_failed ON platform.restore_drill (ran_at DESC) WHERE NOT ok;

-- DOWN
-- DROP TABLE IF EXISTS platform.restore_drill;
-- DROP TABLE IF EXISTS platform.backup_run;
