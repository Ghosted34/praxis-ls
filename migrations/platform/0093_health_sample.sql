-- ============================================================================
-- PLATFORM DB — 0093 Health samples (PROMPT_ErrorMonitor_Module §8.2, §13.12)
-- ============================================================================
--
-- The Overview widget is specified as "99.97% Uptime (30d)". Until now it showed
-- a status derived from error counts instead, and 0090 deliberately did NOT
-- create the spec's `admin_health_metrics` table, on the grounds that a table
-- nothing fills is worse than no table: it looks like a feature, reads as empty,
-- and the first person to query it concludes the platform has no uptime.
--
-- That reasoning still holds. What changed is that there is now a collector —
-- jobs/handlers/health-collect.js — so the table has a producer before it has a
-- consumer, which is the order these two have to land in.
--
-- HOW UPTIME IS COMPUTED, AND THE FLAW YOU MUST KNOW ABOUT
--
-- The naive query is `avg(healthy::int)` over the window. It is WRONG, and
-- wrong in the direction that matters: the collector runs inside the platform's
-- own worker, so when the platform is down it writes NO ROW AT ALL. An outage
-- therefore contributes zero unhealthy samples, and `avg(healthy)` reports
-- 100% for the week you were paged three times. A self-monitoring uptime figure
-- that cannot see its own downtime is not a metric, it is a decoration.
--
-- So uptime is computed against EXPECTED samples, not recorded ones:
--
--     uptime% = healthy_samples / expected_samples
--     expected = elapsed_seconds / HEALTH_SAMPLE_INTERVAL
--
-- A missing sample counts as downtime. This deliberately conflates "the API was
-- down" with "the worker was down", and that conflation is correct for this
-- number's purpose: if the worker is not running, nobody is being paged either,
-- and a platform that cannot alert is not up in any sense an operator cares
-- about. `errors.service.uptime()` clamps `expected` to the first sample so a
-- freshly migrated deployment does not report 3% on day one.
--
-- GRAIN: one row per collector tick — NOT one per (metric, tick) as the spec's
-- `admin_health_metrics` shape implies. A tick's latencies and status are one
-- observation of one system at one instant; splitting them into three rows keyed
-- by metric_name means every query that wants "was it up, and how slow was the
-- database" is a self-join, and the three rows can be independently purged into
-- an inconsistent state.
--
-- RETENTION: 30 days, matching error_event, purged by the same daily job. At the
-- default 60s interval that is ~43k rows — small enough that the partial index
-- below is about query shape rather than size.
--
-- DOWN
-- Fully additive: one table, nothing references it. Dropping it loses uptime
-- history; the widget falls back to "—" rather than breaking.
--
-- DROP TABLE IF EXISTS platform.health_sample;

CREATE TABLE platform.health_sample (
  -- bigserial, not uuid. This is append-only time-series written every minute
  -- forever and read in recorded_at order; a random uuid primary key would
  -- scatter inserts across the btree for no benefit, since nothing ever
  -- references a sample by id.
  sample_id        bigserial PRIMARY KEY,
  recorded_at      timestamptz NOT NULL DEFAULT now(),

  -- The uptime numerator. TRUE means every hard dependency answered; a degraded
  -- but servable process is still healthy here, matching /health/ready's own
  -- rule that degraded returns 200.
  healthy          boolean NOT NULL,
  status           text NOT NULL CHECK (status IN ('ready', 'degraded', 'unavailable')),

  -- Nullable on purpose: a probe that timed out has no latency, and storing 0
  -- would drag every average toward "fast" precisely when things are slow.
  db_latency_ms    integer,
  redis_latency_ms integer,

  -- The per-component verdicts, so "what was broken at 03:12" is answerable
  -- without keeping a separate row per component.
  components       jsonb NOT NULL DEFAULT '{}'::jsonb,
  release          text
);

-- Every read is a time range; there is no other access pattern.
CREATE INDEX ix_health_sample_time ON platform.health_sample (recorded_at DESC);
-- The status timeline on the Overview widget only cares about the bad ones, and
-- they are a tiny fraction of the table.
CREATE INDEX ix_health_sample_bad ON platform.health_sample (recorded_at DESC) WHERE NOT healthy;

-- DOWN
-- DROP TABLE IF EXISTS platform.health_sample;
