/**
 * Health sampling and the uptime figure (spec §8.2 "99.97% Uptime (30d)").
 *
 * §7 of the testing doc recorded this as deliberately NOT built, with a reason
 * worth keeping: `admin_health_metrics` was not created because nothing would
 * fill it, and a table that reads empty is worse than an absent one — it looks
 * like a feature and answers "we have no uptime". The collector below is what
 * changes that, and it had to land before the table meant anything.
 *
 * ── THE FLAW EVERY SELF-HOSTED UPTIME NUMBER HAS ────────────────────────────
 *
 * The obvious query is `avg(healthy::int)` over the window. It is wrong in the
 * one direction that matters. The collector runs inside this platform's own
 * worker, so during an outage it writes NO ROW — an outage contributes zero
 * unhealthy samples, and the average reports 100% for the week you were paged
 * three times. A monitor that cannot see its own downtime is decoration.
 *
 * So the denominator is EXPECTED samples, derived from wall-clock elapsed time
 * and the collector interval, not from rows present:
 *
 *     uptime% = healthy_samples / expected_samples
 *     expected = elapsed_seconds / interval_seconds
 *
 * A missing sample is downtime. That deliberately conflates "the API was down"
 * with "the worker was down", and the conflation is correct here: if the worker
 * is not running then nothing is evaluating escalation rules either, so nobody
 * is being paged — which is not "up" in any sense an operator means.
 *
 * TWO CLAMPS, both of which exist because the naive version lies on day one:
 *
 *   1. `expected` starts at the FIRST sample, not at the window start. A
 *      deployment migrated an hour ago has one hour of samples and would
 *      otherwise report 0.14% uptime over 30 days, which is not a number anyone
 *      would believe or act on. It reports over the period it can actually
 *      speak to, and says so via `measured_from`.
 *   2. `healthy` is capped at `expected`. Clock skew or a doubled worker can
 *      produce more samples than expected and a 100.3% uptime, which destroys
 *      confidence in the figure far more than a percent of inaccuracy would.
 */

"use strict";

const db = require("./db");
const { config } = require("../../config/env");

/** Matches error_event so one purge job can cover both. */
const RETENTION_DAYS = 30;

/** The collector's cadence, in seconds — the denominator's unit. */
function intervalSeconds() {
  const ms = Number(config.HEALTH_SAMPLE_INTERVAL_MS) || 60_000;
  return Math.max(1, Math.round(ms / 1000));
}

/**
 * Take one observation and store it.
 *
 * Probes the platform pool and Redis directly rather than issuing an HTTP
 * request to /health/ready. An in-process probe measures what the process can
 * reach; an HTTP self-call also measures the loopback interface and its own
 * middleware stack, and — the reason it is not done — it cannot run at all when
 * the listener is the thing that is broken, which is precisely the sample worth
 * having.
 *
 * Never throws. A collector that can fail is a collector that stops silently,
 * and its silence is indistinguishable from an outage in the numbers above.
 */
async function sample() {
  const components = {};
  let dbLatency = null;
  let redisLatency = null;

  // Postgres is the hard dependency: nothing this API does is servable without
  // it, which is the same rule /health/ready applies.
  let healthy = true;
  try {
    const started = Date.now();
    await db.query("SELECT 1");
    dbLatency = Date.now() - started;
    components.postgres = { status: "up", latency_ms: dbLatency };
  } catch (err) {
    healthy = false;
    components.postgres = { status: "down", error: String(err.message || err).slice(0, 200) };
  }

  // Redis degrades rather than fails, matching /health/ready. Sessions, rate
  // limiting and job enqueueing are all impaired, but requests are still served
  // — recording that as downtime would make the uptime figure disagree with the
  // load balancer, and then neither would be trusted.
  try {

    const { getClient } = require("../../config/redis");
    const started = Date.now();
    await getClient().ping();
    redisLatency = Date.now() - started;
    components.redis = { status: "up", latency_ms: redisLatency };
  } catch (err) {
    components.redis = { status: "down", error: String(err.message || err).slice(0, 200) };
  }

  const status = !healthy ? "unavailable" : components.redis.status === "down" ? "degraded" : "ready";

  try {
    await db.query(
      `INSERT INTO platform.health_sample
         (healthy, status, db_latency_ms, redis_latency_ms, components, release)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [healthy, status, dbLatency, redisLatency, JSON.stringify(components), config.BUILD_SHA || null],
    );
  } catch {
    /* If Postgres is down we already know — that is what this sample says. There
       is nowhere else to write it, and throwing would only kill the job. */
  }

  return { healthy, status, db_latency_ms: dbLatency, redis_latency_ms: redisLatency, components };
}

/**
 * The Overview widget's numbers (§8.2) and the spec's `GET /admin/health`.
 *
 * @param {{ days?: number }} opts
 */
async function uptime({ days = RETENTION_DAYS } = {}) {
  const window = Math.min(RETENTION_DAYS, Math.max(1, Number(days) || RETENTION_DAYS));
  const interval = intervalSeconds();

  const { rows } = await db.query(
    `SELECT
       COUNT(*)::int                                        AS samples,
       COUNT(*) FILTER (WHERE healthy)::int                 AS healthy,
       COUNT(*) FILTER (WHERE status = 'degraded')::int     AS degraded,
       MIN(recorded_at)                                     AS first_sample,
       MAX(recorded_at)                                     AS last_sample,
       AVG(db_latency_ms)                                   AS avg_db_latency_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY db_latency_ms) AS p95_db_latency_ms
     FROM platform.health_sample
     WHERE recorded_at >= now() - make_interval(days => $1::int)`,
    [window],
  );

  const s = rows[0];

  // No collector has ever run. Report that honestly rather than inventing a
  // figure — a fabricated 100% is exactly what 0090 refused to create a table
  // for.
  if (!s || !s.samples) {
    return {
      uptime_percent: null,
      window_days: window,
      samples: 0,
      expected_samples: 0,
      measured_from: null,
      last_sample: null,
      degraded_samples: 0,
      avg_db_latency_ms: null,
      p95_db_latency_ms: null,
      collector: config.HEALTH_SAMPLE_INTERVAL_MS === 0 ? "disabled" : "no_samples",
    };
  }

  // Clamp 1: measure from the first sample, not the window start.
  const windowStart = Date.now() - window * 86_400_000;
  const measuredFrom = Math.max(new Date(s.first_sample).getTime(), windowStart);
  const elapsed = Math.max(interval, (Date.now() - measuredFrom) / 1000);
  const expected = Math.max(1, Math.round(elapsed / interval));

  // Clamp 2: never report above 100%.
  const healthy = Math.min(s.healthy, expected);

  return {
    uptime_percent: Math.round((healthy / expected) * 10000) / 100,
    window_days: window,
    samples: s.samples,
    expected_samples: expected,
    // Named so the caller can say "over the last 6 hours" when that is all the
    // data there is, instead of implying 30 days of evidence.
    measured_from: new Date(measuredFrom).toISOString(),
    last_sample: s.last_sample,
    degraded_samples: s.degraded,
    avg_db_latency_ms: s.avg_db_latency_ms === null ? null : Math.round(Number(s.avg_db_latency_ms)),
    p95_db_latency_ms: s.p95_db_latency_ms === null ? null : Number(s.p95_db_latency_ms),
    collector: "running",
  };
}

/**
 * The incident timeline behind the percentage — contiguous runs of unhealthy
 * samples, collapsed into outages.
 *
 * Returned as runs rather than raw samples because "0.03% down" is not
 * actionable and "one 13-minute outage on the 4th" is. The gap threshold is two
 * intervals, so a single missed tick does not split one outage into two.
 */
async function incidents({ days = RETENTION_DAYS, limit = 20 } = {}) {
  const window = Math.min(RETENTION_DAYS, Math.max(1, Number(days) || RETENTION_DAYS));
  const interval = intervalSeconds();

  const { rows } = await db.query(
    `WITH bad AS (
       SELECT recorded_at, status,
              recorded_at - (make_interval(secs => $2::int) *
                ROW_NUMBER() OVER (ORDER BY recorded_at)) AS grp
         FROM platform.health_sample
        WHERE NOT healthy
          AND recorded_at >= now() - make_interval(days => $1::int)
     )
     SELECT MIN(recorded_at) AS started_at,
            MAX(recorded_at) AS ended_at,
            COUNT(*)::int    AS samples
       FROM bad
      GROUP BY grp
      ORDER BY 1 DESC
      LIMIT $3`,
    [window, interval, Math.min(100, Math.max(1, Number(limit) || 20))],
  );

  return rows.map((r) => ({
    started_at: r.started_at,
    ended_at: r.ended_at,
    samples: r.samples,
    // +1 interval: the outage began somewhere in the gap after the last healthy
    // sample, so its measured length understates it by up to one tick.
    duration_seconds: (r.samples + 1) * interval,
  }));
}

/**
 * Is the error pipeline itself still working? (Appendix A.5 — "stale detection:
 * alert if no errors written recently, possible logging failure".)
 *
 * THE PROBLEM THIS SOLVES IS THE ONLY ONE THE DASHBOARD CANNOT SHOW YOU.
 *
 * Every other failure in this module is visible as a wrong number. This one is
 * visible as a RIGHT number: if capture breaks — the store's flush silently
 * failing, the platform pool exhausted, a bad deploy dropping the error handler
 * — the Error Center renders a clean, empty, green feed. Zero errors and
 * "everything is fine" are the same picture, and the second is what everyone
 * reads. A monitoring system's worst failure is looking healthy.
 *
 * WHY THIS IS HARDER THAN "no rows for an hour"
 *
 * A genuinely quiet platform also writes no rows, and crying wolf at 3am on a
 * good night is how an alert gets muted. So silence alone is not the signal.
 * The signal is silence WHILE THE PLATFORM IS DEMONSTRABLY ALIVE — which is
 * exactly what health_sample knows and error_event does not.
 *
 *   - health samples still arriving  → the worker and the database are fine
 *   - and no error in a long time    → capture is suspect, not the platform
 *
 * A quiet night has both silent. A broken pipeline has one silent and one not.
 *
 * `stale` is therefore only ever true when we can prove we were watching, and
 * `reason` says which of the two states we are in so the UI never has to guess.
 */
async function captureHealth({ quietHours = 24 } = {}) {
  const { rows } = await db.query(
    `SELECT
       (SELECT max(last_seen)   FROM platform.error_event)  AS last_error_at,
       (SELECT count(*)::int    FROM platform.error_event
          WHERE last_seen > now() - make_interval(hours => $1::int)) AS errors_in_window,
       (SELECT max(recorded_at) FROM platform.health_sample) AS last_sample_at,
       (SELECT count(*)::int    FROM platform.health_sample
          WHERE recorded_at > now() - make_interval(hours => $1::int)) AS samples_in_window`,
    [quietHours],
  );

  const s = rows[0] || {};
  const interval = intervalSeconds();
  const sampleAgeSeconds = s.last_sample_at
    ? Math.round((Date.now() - new Date(s.last_sample_at).getTime()) / 1000)
    : null;

  // "Was anyone watching?" — a collector that stopped three days ago proves
  // nothing about whether errors were being captured yesterday. Three missed
  // ticks rather than one, so an ordinary restart is not mistaken for evidence.
  const collectorLive = sampleAgeSeconds !== null && sampleAgeSeconds < interval * 3;

  // Enough samples to call the window covered. Below this we simply have not
  // been running long enough to have an opinion, and saying so beats guessing.
  const covered = (s.samples_in_window || 0) >= Math.max(3, (quietHours * 3600) / interval / 2);

  let reason;
  if (!collectorLive) reason = "collector_down";
  else if (!covered) reason = "insufficient_history";
  else if ((s.errors_in_window || 0) > 0) reason = "capturing";
  else reason = "no_errors_while_healthy";

  return {
    stale: reason === "no_errors_while_healthy",
    reason,
    quiet_hours: quietHours,
    last_error_at: s.last_error_at || null,
    errors_in_window: s.errors_in_window || 0,
    last_sample_at: s.last_sample_at || null,
    sample_age_seconds: sampleAgeSeconds,
  };
}

/** Retention, run by the same daily job as the error purge. */
async function purge({ days = RETENTION_DAYS } = {}) {
  const { rowCount } = await db.query(
    "DELETE FROM platform.health_sample WHERE recorded_at < now() - make_interval(days => $1::int)",
    [days],
  );
  return { deleted: rowCount, days };
}

module.exports = { sample, uptime, incidents, captureHealth, purge, intervalSeconds, RETENTION_DAYS };
