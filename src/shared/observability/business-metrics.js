/**
 * Business metrics — the numbers that catch a failure the process cannot.
 *
 * Audit OBS-M2 (High). The database already holds everything needed —
 * `immutable_ledger`, `event_log`, `event_dispatch`, `journal_entry`,
 * `invoice`, `approval_task` — and nothing surfaced invoices posted per hour,
 * approvals stuck pending, DEAD events, or failed deliveries.
 *
 * WHY THIS CLASS OF METRIC AND NOT MORE OF THE OTHER KIND
 *
 * Everything in `metrics.js` today answers "is the process healthy": request
 * rate, latency, error counts, pool occupancy. Those catch a process that is
 * broken. They cannot catch the failure this system is most exposed to, which
 * the audit states plainly: the app is UP, returns 200, and is silently doing
 * nothing or the wrong thing.
 *
 * Concretely — the depreciation bug (DATA 5.5) marked schedule rows posted with
 * no journal entry, and every subsequent run skipped the period. Uptime was
 * 100%. Error rate was zero. The only visible symptom was that a number which
 * should have been rising was flat, and nobody was looking at it because
 * nothing published it.
 *
 * DESIGN CONSTRAINTS THAT SHAPED THIS
 *
 * 1. IT MUST NOT COST A QUERY PER SCRAPE PER TENANT. A Prometheus scrape every
 *    15 seconds across a fleet would be its own load problem, and PERF S1 is
 *    about a connection budget. So this refreshes on a timer, caches, and the
 *    scrape reads the cache.
 *
 * 2. A SLOW OR BROKEN TENANT MUST NOT BREAK THE ENDPOINT. Each tenant is
 *    collected independently; a failure is counted and reported as a metric of
 *    its own rather than propagated.
 *
 * 3. IT MUST READ, NEVER WRITE, AND NEVER LOCK. Every statement is a plain
 *    aggregate with a bounded time window.
 */

"use strict";

const metrics = require("./metrics");
const { logger } = require("../../config/logger");

/** How often to recompute. Slow on purpose — see constraint 1. */
const REFRESH_MS = Number(process.env.BUSINESS_METRICS_INTERVAL_MS || 60_000);

/**
 * Each probe returns rows of `{ label..., value }` and names the gauge it
 * feeds. Kept declarative so adding a metric is one entry, and so the whole
 * catalogue is readable in one screen — the reason nobody added these before is
 * that there was no obvious place to put them.
 */
const PROBES = [
  {
    gauge: "praxis_invoices_posted_total",
    help: "Invoices posted, by status, over the last 24 hours.",
    sql: `SELECT status, COUNT(*)::int AS value
            FROM invoice
           WHERE type = 'FINAL' AND updated_at > now() - interval '24 hours'
           GROUP BY status`,
    labels: (r) => ({ status: r.status }),
  },
  {
    gauge: "praxis_journal_entries_posted_total",
    help: "Journal entries written in the last 24 hours, by status.",
    sql: `SELECT status, COUNT(*)::int AS value
            FROM journal_entry
           WHERE created_at > now() - interval '24 hours'
           GROUP BY status`,
    labels: (r) => ({ status: r.status }),
  },
  {
    // The one that would have caught DATA 5.5. A posted row with no entry is
    // now impossible going forward (migration 0502), so a non-zero value here
    // means either historical damage or a constraint that got dropped.
    gauge: "praxis_depreciation_posted_without_entry",
    help: "Depreciation rows marked posted with no journal entry. Should be zero.",
    sql: `SELECT COUNT(*)::int AS value FROM depreciation_schedule WHERE posted AND entry_id IS NULL`,
    labels: () => ({}),
  },
  {
    gauge: "praxis_approvals_pending",
    help: "Open approval tasks, bucketed by how long they have waited.",
    sql: `SELECT CASE
                   WHEN created_at > now() - interval '1 day'  THEN 'under_1d'
                   WHEN created_at > now() - interval '7 days' THEN 'under_7d'
                   ELSE 'over_7d'
                 END AS age,
                 COUNT(*)::int AS value
            FROM approval_task
           WHERE status = 'PENDING'
           GROUP BY age`,
    labels: (r) => ({ age: r.age }),
  },
  {
    // OBS-A6's counterpart. `over_7d` rising is a workflow nobody is servicing;
    // DEAD events are business facts that were never delivered at all.
    gauge: "praxis_events_undelivered",
    help: "Orchestration events by dispatch state — DEAD are permanently undelivered.",
    sql: `SELECT status, COUNT(*)::int AS value
            FROM event_dispatch
           WHERE status IN ('DEAD', 'RETRY')
           GROUP BY status`,
    labels: (r) => ({ status: r.status }),
  },
  {
    gauge: "praxis_ledger_writes_total",
    help: "Immutable-ledger rows written in the last hour. Flat means nothing is happening.",
    sql: `SELECT COUNT(*)::int AS value FROM immutable_ledger WHERE created_at > now() - interval '1 hour'`,
    labels: () => ({}),
  },
];

let timer = null;
let lastRun = null;

/** Collect one tenant. Never throws. */
async function collectTenant(registry, meta) {
  const t0 = Date.now();
  try {
    await registry.withTenantConnection(meta, "live", async (client) => {
      for (const probe of PROBES) {
        try {
           
          const { rows } = await client.query(probe.sql);
          for (const row of rows) {
            metrics.setGauge(
              probe.gauge,
              { tenant: meta.slug, ...probe.labels(row) },
              Number(row.value) || 0,
              probe.help,
            );
          }
          // A GROUP BY that matches nothing returns no rows, which would leave
          // the previous value standing forever. Zero is the honest reading.
          if (rows.length === 0) {
            metrics.setGauge(probe.gauge, { tenant: meta.slug }, 0, probe.help);
          }
        } catch (err) {
          // A probe whose table does not exist on this tenant (mid-migration,
          // or a feature not provisioned) is expected, not exceptional.
          logger.debug({ err, tenant: meta.slug, gauge: probe.gauge },
            "business metric probe skipped");
        }
      }
    });
    metrics.setGauge("praxis_business_metrics_collect_ok", { tenant: meta.slug }, 1,
      "1 when the last business-metrics collection for this tenant succeeded.");
  } catch (err) {
    // Constraint 2: report the failure AS a metric. A tenant that cannot be
    // collected is exactly the tenant you want an alert about.
    metrics.setGauge("praxis_business_metrics_collect_ok", { tenant: meta.slug }, 0,
      "1 when the last business-metrics collection for this tenant succeeded.");
    logger.warn({ err, tenant: meta.slug }, "business metrics collection failed");
  } finally {
    metrics.setGauge("praxis_business_metrics_collect_seconds", { tenant: meta.slug },
      (Date.now() - t0) / 1000, "Wall time of the last business-metrics collection.");
  }
}

/** One pass across the fleet. */
async function collectAll() {
  const registry = require("../../services/tenant/registry.service");
  try {
    const tenants = await registry.listActiveTenants();
    for (const meta of tenants) {
       
      await collectTenant(registry, meta);
    }
    lastRun = new Date().toISOString();
    metrics.setGauge("praxis_business_metrics_last_run_seconds", {},
      Math.floor(Date.now() / 1000), "Unix time of the last successful fleet-wide collection.");
  } catch (err) {
    logger.warn({ err }, "business metrics: could not list tenants");
  }
}

/**
 * Start the refresh loop.
 *
 * `unref()` so this never holds the process open — a metrics timer must not be
 * the reason a container refuses to shut down.
 */
function start() {
  if (timer) return timer;
  // Deliberately not immediate: at boot the pools are cold and the readiness
  // probe is what matters. One interval of delay costs nothing.
  timer = setInterval(() => {
    collectAll().catch(() => {});
  }, REFRESH_MS);
  timer.unref();
  logger.info({ interval_ms: REFRESH_MS, probes: PROBES.length }, "business metrics collector started");
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, collectAll, PROBES, lastRunAt: () => lastRun };
