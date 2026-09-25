/**
 * Smart Comms call metrics (SMART_COMMS_CALLS_ENGINEERING_GUIDE §7.2, §7.4.4).
 *
 * The producer + reader behind the ops screen: a daily aggregation of what the
 * calls actually did, an alarm on the one failure that must not go unnoticed,
 * and the retention for both.
 *
 * ── WHY THE AGGREGATION IS A JOB AND THE READ IS A TABLE ────────────────────
 *
 * The calls live in each tenant's database. There is no cross-database join, so
 * "how are calls working" has exactly two possible shapes: ask every tenant's
 * database every time somebody opens the screen, or ask them once a day and
 * write the answer where the console can read it. The first is a fleet-wide
 * fan-out on a page load — the shape of query that already took the fleet down
 * once (services/platform/db.js explains the ops pool that exists because of
 * it) — and it would get slower with every tenant. The second is one row per
 * tenant per day (migrations/platform/0107).
 *
 * Since calls audit PR-5 (D4) the HOURLY refresh no longer asks any tenant
 * database: the call service increments day counters in Redis at each
 * transition (smartcomm.call.signals.js) and `refreshFromCounters` writes
 * today's rows from them. The daily 7-day aggregation below is the
 * authoritative repair, served by ix_comms_call_started (14080).
 *
 * ── THE THREE NUMBERS, AND WHAT EACH ONE HONESTLY SAYS ──────────────────────
 *
 *   Reached       calls_answered / calls_started. NOT "calls that worked" —
 *                 a call nobody picked up is the product working, not failing.
 *                 §7.4.4 asks whether the ring gets through, so the outcome
 *                 counts are kept apart rather than summed into a success rate.
 *
 *   Duration      avg_duration_seconds, stored WITH its denominator
 *                 (calls_answered) so the mean over an arbitrary range is
 *                 weighted rather than a mean of means.
 *
 *   Transcription transcription_failed WITH its reasons. The count is the
 *                 alarm; the reasons are what makes the alarm actionable, since
 *                 a provider timeout and an upload that never arrived are the
 *                 same integer and different incidents.
 *
 * ── WHAT THIS FILE DOES NOT DO ──────────────────────────────────────────────
 *
 * It does not decide that a call failed — the call row already did, through the
 * state machine PR-1 built. It does not read the transcript; it counts the row
 * the pipeline marked. Every read here is of a column some other part of the
 * programme already owns, which is the only reason a metric like this is worth
 * trusting: it cannot disagree with the thing it measures.
 */
"use strict";

const registry = require("../tenant/registry.service");
const signals = require("../../modules/smartcomm/smartcomm.call.signals");
const alerts = require("./alert-routing.service");
const runtimeConfig = require("./runtime-config.service");
const { logger } = require("../../config/logger");
// Background work draws from the ops pool (see the INCIDENT note in
// health-rollup.service.js): a fleet aggregation must not compete with the
// connections tenant logins need.
const _db = require("./db");
const platformDb = { query: (t, p) => (_db.opsQuery || _db.query)(t, p) };

/** How far back each run re-aggregates. Long enough that a worker which was
 *  down for a long weekend repairs itself on the next tick, short enough that
 *  the daily cost stays a handful of queries per tenant. */
const REGRESSION_DAYS = 7;

/** See 0107's header for why the window is longer than the 30-day chart. */
const RETENTION_DAYS = 400;

/** The alarm's defaults. Configurable in the vault (`ops.tuning`) first, env
 *  second — the right number depends on how many calls a deployment makes, and
 *  that is not knowable from here. */
const DEFAULT_ALERT_THRESHOLD = 3;
const DEFAULT_ALERT_WINDOW_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `2026-09-20` — the aggregation key, and what the API sends. A date, not a
 *  timestamp: the grain is a calendar day in UTC. The SQL returns it as text
 *  (audit D11: a `date` parsed by node-pg in a non-UTC process shifted a day),
 *  so a string passes through untouched. */
const dayKey = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date(d).toISOString().slice(0, 10));

async function upsertRow({ slug, env, day, row, reasons, endReasons }) {
  await platformDb.query(
    `INSERT INTO platform.comms_call_metric (
       tenant_slug, env, metric_date,
       calls_started, calls_answered, calls_no_answer, calls_declined,
       calls_busy, calls_failed, avg_duration_seconds,
       transcription_failed, transcription_failed_reasons,
       ring_socket, ring_notification, ring_push, ring_none,
       ended_reasons,
       computed_at
     ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17::jsonb, now())
     ON CONFLICT (tenant_slug, env, metric_date) DO UPDATE SET
       calls_started    = EXCLUDED.calls_started,
       calls_answered   = EXCLUDED.calls_answered,
       calls_no_answer  = EXCLUDED.calls_no_answer,
       calls_declined   = EXCLUDED.calls_declined,
       calls_busy       = EXCLUDED.calls_busy,
       calls_failed     = EXCLUDED.calls_failed,
       avg_duration_seconds = EXCLUDED.avg_duration_seconds,
       transcription_failed = EXCLUDED.transcription_failed,
       transcription_failed_reasons = EXCLUDED.transcription_failed_reasons,
       ring_socket      = EXCLUDED.ring_socket,
       ring_notification = EXCLUDED.ring_notification,
       ring_push        = EXCLUDED.ring_push,
       ring_none        = EXCLUDED.ring_none,
       ended_reasons    = EXCLUDED.ended_reasons,
       computed_at      = now()`,
    [
      slug, env, day,
      row.calls_started, row.calls_answered, row.calls_no_answer, row.calls_declined,
      row.calls_busy, row.calls_failed, row.avg_duration_seconds,
      row.transcription_failed, JSON.stringify(reasons || {}),
      row.ring_socket, row.ring_notification, row.ring_push, row.ring_none,
      JSON.stringify(endReasons || {}),
    ],
  );
}

/**
 * Aggregate one tenant+env over the last `days` days and upsert the rows.
 *
 * Runs against the tenant's own connection, inside the schema the caller asked
 * for. Returns the number of day-rows written, not the calls counted — the
 * caller is a job whose log line should say what it stored.
 */
async function aggregateTenant({ tenantMeta, env = "live", days = REGRESSION_DAYS, now = new Date() }) {
  const from = new Date(now.getTime() - days * DAY_MS);
  return registry.withTenantConnection(tenantMeta, env, async (client) => {
    const { rows } = await client.query(
      `SELECT (started_at AT TIME ZONE 'UTC')::date::text                AS metric_date,
              count(*)::int                                             AS calls_started,
              count(*) FILTER (WHERE connected_at IS NOT NULL)::int      AS calls_answered,
              count(*) FILTER (WHERE status = 'NO_ANSWER')::int          AS calls_no_answer,
              count(*) FILTER (WHERE status = 'DECLINED')::int           AS calls_declined,
              count(*) FILTER (WHERE status = 'BUSY')::int               AS calls_busy,
              count(*) FILTER (WHERE status = 'FAILED')::int             AS calls_failed,
              round(avg(duration_seconds) FILTER (WHERE connected_at IS NOT NULL))::int
                                                                         AS avg_duration_seconds,
              count(*) FILTER (WHERE transcription_state = 'TRANSCRIPTION_FAILED')::int
                                                                         AS transcription_failed,
              count(*) FILTER (WHERE ring_ack_channel = 'socket')::int   AS ring_socket,
              count(*) FILTER (WHERE ring_ack_channel = 'notification')::int
                                                                         AS ring_notification,
              count(*) FILTER (WHERE ring_ack_channel = 'push')::int     AS ring_push,
              count(*) FILTER (WHERE ring_ack_channel IS NULL)::int      AS ring_none
         FROM comms_call
        WHERE started_at >= $1
        GROUP BY 1
        ORDER BY 1`,
      [from.toISOString()],
    );

    // The reasons, keyed by day, as their own query rather than a jsonb
    // aggregate over the scan above: `jsonb_object_agg` there would have to put
    // the reason in the GROUP BY, and that would split the outcome counts by
    // reason — every other column in this table would become wrong.
    const { rows: reasonsByDay } = await client.query(
      `SELECT (started_at AT TIME ZONE 'UTC')::date::text             AS metric_date,
              COALESCE(transcription_error, 'reason not recorded')    AS reason,
              count(*)::int                                           AS n
         FROM comms_call
        WHERE started_at >= $1
          AND transcription_state = 'TRANSCRIPTION_FAILED'
        GROUP BY 1, 2`,
      [from.toISOString()],
    );
    const reasons = new Map();
    for (const r of reasonsByDay) {
      const key = dayKey(r.metric_date);
      if (!reasons.has(key)) reasons.set(key, {});
      reasons.get(key)[r.reason] = r.n;
    }

    // How calls ENDED (FN-2), its own query for the same reason as the one
    // above: putting end_reason in the GROUP BY of the outcome scan would
    // split every other column in this table by reason.
    //
    // Answered calls only. A ring that timed out already has its own column
    // (`calls_no_answer`), and counting it here too would make the reasons
    // read as a breakdown of calls_started, which they are not.
    const { rows: endByDay } = await client.query(
      `SELECT (started_at AT TIME ZONE 'UTC')::date::text  AS metric_date,
              COALESCE(end_reason, 'reason not recorded')  AS reason,
              count(*)::int                                AS n
         FROM comms_call
        WHERE started_at >= $1
          AND connected_at IS NOT NULL
          AND status IN ('ENDED', 'FAILED')
        GROUP BY 1, 2`,
      [from.toISOString()],
    );
    const endReasons = new Map();
    for (const r of endByDay) {
      const key = dayKey(r.metric_date);
      if (!endReasons.has(key)) endReasons.set(key, {});
      endReasons.get(key)[r.reason] = r.n;
    }

    let written = 0;
    for (const row of rows) {
      const day = dayKey(row.metric_date);
      await upsertRow({
        slug: tenantMeta.slug,
        env,
        day,
        row,
        reasons: reasons.get(day) || {},
        endReasons: endReasons.get(day) || {},
      });
      written += 1;
    }
    return { written, days: days };
  });
}

/**
 * Aggregate every active tenant, live and (where it exists) sandbox.
 *
 * One tenant's failure does not stop the fleet: a tenant whose database is
 * unreachable is reported in `errors` and skipped, because a metrics job that
 * dies on the first bad tenant produces no metrics for anybody — precisely when
 * somebody would be looking at them.
 */
async function aggregateFleet({ days = REGRESSION_DAYS, now = new Date(), tenants = null } = {}) {
  const meta = tenants || (await registry.listActiveTenants());
  const results = [];
  const errors = [];
  for (const tenantMeta of meta) {
    const envs = tenantMeta.sandbox_schema ? ["live", "sandbox"] : ["live"];
    for (const env of envs) {
      try {
        const r = await aggregateTenant({ tenantMeta, env, days, now });
        results.push({ tenant: tenantMeta.slug, env, days: r.written });
      } catch (err) {
        logger.warn({ err, tenant: tenantMeta.slug, env }, "comms metrics: tenant aggregation failed");
        errors.push({ tenant: tenantMeta.slug, env, message: err.message });
      }
    }
  }
  return { tenants: results.length, rows: results.reduce((n, r) => n + r.days, 0), results, errors };
}

/** One metric row from a tenant's day counters (smartcomm.call.signals). */
function rowFromCounters(f) {
  const n = (k) => Number(f[k]) || 0;
  const reasons = {};
  for (const [k, v] of Object.entries(f)) if (k.startsWith("reason:")) reasons[k.slice(7)] = v;
  const acked = n("ring_socket") + n("ring_notification") + n("ring_push");
  return {
    calls_started: n("calls_started"),
    calls_answered: n("calls_answered"),
    calls_no_answer: n("calls_no_answer"),
    calls_declined: n("calls_declined"),
    calls_busy: n("calls_busy"),
    calls_failed: n("calls_failed"),
    avg_duration_seconds: n("answered_ended") > 0 ? Math.round(n("duration_sum") / n("answered_ended")) : null,
    transcription_failed: n("transcription_failed"),
    reasons,
    ring_socket: n("ring_socket"),
    ring_notification: n("ring_notification"),
    ring_push: n("ring_push"),
    ring_none: Math.max(0, n("calls_started") - acked),
  };
}

/**
 * Write today's (and, just after midnight, yesterday's) rows from the Redis
 * day counters: the hourly refresh, with no tenant database read (audit D4).
 */
async function refreshFromCounters({ now = new Date(), days = 1 } = {}) {
  let written = 0;
  for (let i = 0; i < days; i += 1) {
    const day = dayKey(new Date(now.getTime() - i * DAY_MS));
    for (const { slug, env, fields } of await signals.dayCounters(day)) {
      const r = rowFromCounters(fields);
      await upsertRow({ slug, env, day, row: r, reasons: r.reasons });
      written += 1;
    }
  }
  return { written, source: "counters" };
}

/** The 30-day window the console offers by default, and the cap it may ask for. */
const MAX_WINDOW_DAYS = 400;

/**
 * The console's read model: one fleet series, a per-tenant table, and the
 * totals the header tiles show.
 *
 * The totals are computed in SQL over COUNTS, never over the stored averages —
 * summing `avg_duration_seconds` across tenants would weight a tenant with one
 * call the same as a tenant with a thousand.
 */
async function overview({ days = 30 } = {}) {
  const window = Math.min(Math.max(Number(days) || 30, 1), MAX_WINDOW_DAYS);
  const { rows } = await platformDb.query(
    `SELECT tenant_slug, env, metric_date::text AS metric_date,
            calls_started, calls_answered, calls_no_answer, calls_declined,
            calls_busy, calls_failed, avg_duration_seconds,
            transcription_failed, transcription_failed_reasons,
            ring_socket, ring_notification, ring_push, ring_none,
            ended_reasons, transcription_alert_at, computed_at
       FROM platform.comms_call_metric
      WHERE metric_date >= (now() AT TIME ZONE 'UTC')::date - ($1::int - 1)
      ORDER BY metric_date DESC, tenant_slug`,
    [window],
  );

  const fleet = { days: window, started: 0, answered: 0, failed: 0, transcription_failed: 0,
    ring_socket: 0, ring_notification: 0, ring_push: 0, ring_none: 0,
    duration_weighted: 0, avg_duration_seconds: null, series: [], reasons: {},
    // How answered calls ended, fleet-wide (FN-2). Keyed by end_reason.
    end_reasons: {}, last_computed_at: null };
  const byDay = new Map();
  const byTenant = new Map();

  for (const r of rows) {
    fleet.started += r.calls_started;
    fleet.answered += r.calls_answered;
    fleet.failed += r.calls_failed;
    fleet.transcription_failed += r.transcription_failed;
    fleet.ring_socket += r.ring_socket;
    fleet.ring_notification += r.ring_notification;
    fleet.ring_push += r.ring_push;
    fleet.ring_none += r.ring_none;
    // `!== null`, not `!= null`: eqeqeq is an ERROR in eslint.config.js and a
    // SQL NULL arrives as null (never undefined), so the loose form buys nothing.
    if (r.avg_duration_seconds !== null) fleet.duration_weighted += r.avg_duration_seconds * r.calls_answered;

    for (const [reason, n] of Object.entries(r.transcription_failed_reasons || {})) {
      fleet.reasons[reason] = (fleet.reasons[reason] || 0) + n;
    }
    for (const [reason, n] of Object.entries(r.ended_reasons || {})) {
      fleet.end_reasons[reason] = (fleet.end_reasons[reason] || 0) + n;
    }

    const d = byDay.get(r.metric_date) || { date: r.metric_date, started: 0, answered: 0, failed: 0, transcription_failed: 0 };
    d.started += r.calls_started;
    d.answered += r.calls_answered;
    d.failed += r.calls_failed;
    d.transcription_failed += r.transcription_failed;
    byDay.set(r.metric_date, d);

    const t = byTenant.get(r.tenant_slug) || {
      tenant_slug: r.tenant_slug, envs: new Set(), started: 0, answered: 0, failed: 0,
      transcription_failed: 0, ring_push: 0, ring_none: 0, duration_weighted: 0,
      rings: { socket: 0, notification: 0, push: 0, none: 0 }, avg_duration_seconds: null,
      last_computed_at: null,
    };
    t.envs.add(r.env);
    t.started += r.calls_started;
    t.answered += r.calls_answered;
    t.failed += r.calls_failed;
    t.transcription_failed += r.transcription_failed;
    t.rings.socket += r.ring_socket;
    t.rings.notification += r.ring_notification;
    t.rings.push += r.ring_push;
    t.rings.none += r.ring_none;
    if (r.avg_duration_seconds !== null) t.duration_weighted += r.avg_duration_seconds * r.calls_answered;
    if (!t.last_computed_at || r.computed_at > t.last_computed_at) t.last_computed_at = r.computed_at;
    byTenant.set(r.tenant_slug, t);

    if (!fleet.last_computed_at || r.computed_at > fleet.last_computed_at) fleet.last_computed_at = r.computed_at;
  }

  for (const d of byDay.values()) fleet.series.push(d);
  fleet.series.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (fleet.answered > 0) fleet.avg_duration_seconds = Math.round(fleet.duration_weighted / fleet.answered);

  const tenants = [...byTenant.values()].map((t) => {
    const rings = t.rings;
    return {
      tenant_slug: t.tenant_slug,
      envs: [...t.envs].sort(),
      started: t.started,
      answered: t.answered,
      failed: t.failed,
      transcription_failed: t.transcription_failed,
      avg_duration_seconds: t.answered > 0 ? Math.round(t.duration_weighted / t.answered) : null,
      rings,
      ring_acknowledged: rings.socket + rings.notification + rings.push,
      last_computed_at: t.last_computed_at,
    };
  });
  tenants.sort((a, b) => b.started - a.started || (a.tenant_slug < b.tenant_slug ? -1 : 1));

  // `duration_weighted` is an implementation detail of the mean and must not
  // leak into the API: a client that rendered it would show a number that is
  // meaningless on its own.
  delete fleet.duration_weighted;
  return { fleet, tenants };
}

/**
 * Raise the alarm when the never-dies guarantee is failing at a rate.
 *
 * §4.5 has exactly one visible failure path and PR-2 already alerts on it, once
 * per call, at `notify`. That is the right level for one call: the caller still
 * has words, a labelled draft and a daily reprocess. It is the wrong level for
 * a RATE, which is what this evaluates — ten calls in a day is not ten
 * separate pieces of bad luck, it is a provider outage, a bad key or a queue
 * that has stopped, and the transcript-never-dies guarantee is only as good as
 * its alarm.
 *
 * DEDUPE IS PART OF THE ALARM, not a nicety. The evaluator runs hourly; a
 * condition that persists all day would page twenty-four times, which is how an
 * alert becomes something people mute — and a muted alert is worse than none,
 * because it looks like coverage. So the raise is stamped on the day's row
 * (`transcription_alert_at`) and not repeated inside the window.
 *
 * Returns what it decided and why, so the job can log a sentence an operator
 * can act on and so the test does not have to infer the decision from a mock.
 */
async function evaluateTranscriptionAlert({ now = new Date(), windowHours, threshold } = {}) {
  const tuning = await runtimeConfig.opsTuning();
  const hours = Number(windowHours || tuning.commsTranscriptionAlertWindowHours || DEFAULT_ALERT_WINDOW_HOURS);
  const limit = Number(threshold || tuning.commsTranscriptionAlertThreshold || DEFAULT_ALERT_THRESHOLD);
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000);

  // Per tenant AND env, live only (audit D5): a training sandbox's failures
  // are nobody's incident, and mixing them in paged on demo calls.
  const { rows } = await platformDb.query(
    `SELECT tenant_slug, env,
            sum(transcription_failed)::int AS failed,
            max(transcription_alert_at)    AS last_alert_at
       FROM platform.comms_call_metric
      WHERE metric_date >= ($1::timestamptz AT TIME ZONE 'UTC')::date
        AND env = 'live'
      GROUP BY tenant_slug, env
      ORDER BY tenant_slug`,
    [since.toISOString()],
  );

  const raised = [];
  const skipped = [];
  for (const r of rows) {
    if (r.failed < limit) {
      skipped.push({ tenant: r.tenant_slug, failed: r.failed, reason: "below threshold" });
      continue;
    }
    if (r.last_alert_at && new Date(r.last_alert_at) >= since) {
      skipped.push({ tenant: r.tenant_slug, failed: r.failed, reason: "already raised inside the window" });
      continue;
    }

    const reasons = await platformDb.query(
      `SELECT transcription_failed_reasons
         FROM platform.comms_call_metric
        WHERE tenant_slug = $1 AND env = 'live'
          AND metric_date >= ($2::timestamptz AT TIME ZONE 'UTC')::date
        ORDER BY metric_date DESC`,
      [r.tenant_slug, since.toISOString()],
    );
    const merged = {};
    for (const row of reasons.rows) {
      for (const [reason, n] of Object.entries(row.transcription_failed_reasons || {})) {
        merged[reason] = (merged[reason] || 0) + n;
      }
    }

    const result = await alerts.raise({
      event: "comms.transcription_sustained",
      subject: `${r.failed} calls could not be fully transcribed in the last ${hours}h (threshold ${limit})`,
      detail: { tenant: r.tenant_slug, window_hours: hours, threshold: limit, failed: r.failed, reasons: merged },
      tenant: r.tenant_slug,
    });
    raised.push({ tenant: r.tenant_slug, failed: r.failed, delivered: result.delivered, reason: result.reason });

    // Stamped after the raise, and only for the day rows inside the window: if
    // the stamp write fails, the worst case is a second alert, which is the
    // right way round — a duplicate page is recoverable, a swallowed one is not.
    await platformDb.query(
      `UPDATE platform.comms_call_metric
          SET transcription_alert_at = now()
        WHERE tenant_slug = $1 AND env = 'live'
          AND metric_date >= ($2::timestamptz AT TIME ZONE 'UTC')::date`,
      [r.tenant_slug, since.toISOString()],
    );
  }

  return { window_hours: hours, threshold: limit, raised, skipped };
}

/**
 * The latency alarm (§4 item 8; PR-5 step 6): per live tenant, page when the
 * p95 hang-up→summary of the last hour is over its target, or when the
 * oldest waiting part is older than its limit. Read from Redis signals, so
 * it costs no tenant database read. Deduplicated per tenant per window with
 * a Redis key, for the same reason as the failure alarm: a page every hour
 * for one condition gets muted.
 */
async function evaluateLatencyAlert({ now = new Date(), p95Seconds, backlogSeconds, windowHours = DEFAULT_ALERT_WINDOW_HOURS } = {}) {
  const { config } = require("../../config/env");
  const p95Limit = Number(p95Seconds || config.COMMS_CALL_SUMMARY_P95_ALERT_S || 120);
  const ageLimit = Number(backlogSeconds || config.COMMS_CALL_BACKLOG_ALERT_AGE_S || 600);
  const signalsNow = await signals.tenantSignals({ now: now.getTime() });
  const raised = [];
  const ok = [];
  for (const s of signalsNow) {
    if (s.env !== "live") continue;
    const slow = s.p95_s !== null && s.p95_s > p95Limit;
    const stuck = s.oldest_waiting_s > ageLimit;
    if (!slow && !stuck) { ok.push({ tenant: s.tenant }); continue; }
    const r = require("../../config/redis").getClient();
    const claimed = await r.set(`praxis:callalert:latency:${s.tenant}`, "1", "EX", Math.round(windowHours * 3600), "NX");
    if (claimed !== "OK") { ok.push({ tenant: s.tenant, reason: "already raised inside the window" }); continue; }
    const subject = slow
      ? `Call summaries are slow: p95 ${Math.round(s.p95_s)} s from hang-up over the last hour (target ${p95Limit} s)`
      : `Call transcription is backed up: the oldest part has waited ${Math.round(s.oldest_waiting_s / 60)} min`;
    const result = await alerts.raise({
      event: "comms.transcription_latency",
      subject,
      detail: { ...s, p95_limit_s: p95Limit, backlog_limit_s: ageLimit },
      tenant: s.tenant,
    });
    raised.push({ tenant: s.tenant, slow, stuck, delivered: result.delivered });
  }
  return { p95_limit_s: p95Limit, backlog_limit_s: ageLimit, raised, ok, signals: signalsNow };
}

/** 400-day retention for the metric rows. Returns the number deleted. */
async function purge({ days = RETENTION_DAYS, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const { rowCount } = await platformDb.query(
    `DELETE FROM platform.comms_call_metric
      WHERE metric_date < ($1::timestamptz AT TIME ZONE 'UTC')::date`,
    [cutoff.toISOString()],
  );
  return { deleted: rowCount || 0, older_than_days: days };
}

/** The alarm's two numbers, resolved the way the evaluator resolves them, so the
 *  console can show what is actually in force rather than what the code
 *  defaults to. */
async function alertConfig() {
  const tuning = await runtimeConfig.opsTuning();
  return {
    threshold: Number(tuning.commsTranscriptionAlertThreshold || DEFAULT_ALERT_THRESHOLD),
    window_hours: Number(tuning.commsTranscriptionAlertWindowHours || DEFAULT_ALERT_WINDOW_HOURS),
    source: tuning.source || "env",
  };
}

module.exports = {
  REGRESSION_DAYS,
  RETENTION_DAYS,
  DEFAULT_ALERT_THRESHOLD,
  DEFAULT_ALERT_WINDOW_HOURS,
  MAX_WINDOW_DAYS,
  aggregateTenant,
  aggregateFleet,
  refreshFromCounters,
  rowFromCounters,
  overview,
  evaluateTranscriptionAlert,
  evaluateLatencyAlert,
  purge,
  alertConfig,
};
