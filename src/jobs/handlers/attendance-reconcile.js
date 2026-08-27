/**
 * Worker job: reconcile one tenant environment's attendance for a date (0697),
 * and — on the morning a week becomes reportable — summarise that week's
 * lateness (PR3, guide §3.4).
 *
 * Runs on completed days, not live ones — see `reconcileDate`'s default. A day
 * still in progress has no absences, only people who have not arrived yet, and
 * charging them at 09:00 would be nonsense.
 *
 * Re-running is free by construction (upsert on (employee, date), waivers and
 * raised queries preserved), which is what lets this be scheduled daily AND
 * pressed by hand after a punch correction or a late leave approval without
 * anybody having to think about it.
 *
 * ── WHY THE WEEKLY SUMMARY RIDES HERE ──────────────────────────────────────
 *
 * It has exactly the same trigger — the nightly pass, in the tenant's own zone,
 * over days that are definitively finished — and it reads the rows this job has
 * just written. A sibling job at Monday 00:30 would need its own tenant fan-out,
 * its own schedule and its own answer to "what if it runs before reconciliation
 * finished Sunday?"; a step here cannot race the reconciler because it IS after
 * the reconciler.
 *
 * Gated on Monday in the workplace zone (the guide's "after the week closes"),
 * so the other six nights cost one date comparison. Running on a Wednesday would
 * not be wrong — the upsert is idempotent and `lastCompletedWeek` names the same
 * week all week — it would simply rewrite the same six rows every night.
 *
 * ── AND WHY IT CANNOT FAIL THE RECONCILE ───────────────────────────────────
 *
 * Rule 1 of the guide, applied one level up: reconciliation is what decides what
 * people are PAID. A summariser that raises a question about a pattern must
 * never be able to take that down with it — if the weekly writer throws, the
 * day is still reconciled, the job still succeeds, and the reconcile result
 * goes back to the caller unchanged. The failure is logged, and the next
 * night's run (or the backfill endpoint) picks the week up again, because the
 * upsert makes a retry indistinguishable from a first attempt.
 *
 * WHICH IS WHY IT TAKES ITS OWN CONNECTION, and a try/catch is not enough on
 * its own. `withTenantConnection` wraps `fn` in BEGIN…COMMIT on the pooled path
 * (sandbox, and any tenant whose role predates the server-side search_path
 * default). A failed INSERT inside that transaction leaves it ABORTED, so the
 * COMMIT that follows is turned into a rollback by Postgres and every row the
 * reconciler just wrote is discarded — while a swallowed error meant the job
 * still reported success. That is strictly worse than failing loudly: a night
 * where nothing was charged, and nothing said so.
 *
 * So the reconcile commits FIRST, on its own connection, and the weekly step
 * runs afterwards on a second one. A weekly failure can then roll back only the
 * weekly transaction, which is exactly the blast radius it should have.
 *
 * Job data: { tenantMeta, env, date? }.
 */
"use strict";
const registry = require("../../services/tenant/registry.service");
const reconcile = require("../../modules/hr/attendance/attendance.reconcile");
const weekly = require("../../modules/hr/attendance/attendance.weekly");
const rules = require("../../modules/hr/attendance/attendance.rules");
const { logger } = require("../../config/logger");

/**
 * The weekly step itself, given a connection. Deliberately does NOT catch: the
 * swallow belongs to `runWeeklyStep` below, one layer out, where it can also
 * cover the acquire and the COMMIT — the two failures this function never sees.
 *
 * Returns null on the six nights that are not a Monday.
 */
async function weeklyStep(client, { tenant, env }) {
  const timeZone = await reconcile.timezoneOf(client);
  const today = rules.localDate(new Date(), timeZone);
  if (!weekly.isMonday(today)) return null;
  const out = await weekly.runWeekly(client, { today, timeZone });
  logger.info({ tenant, env, ...out }, "[attendance] weekly lateness queries raised");
  return out;
}

/**
 * The weekly step on its OWN tenant connection, and the one place its failure
 * is swallowed. Never throws — see the header for why a second connection is
 * load-bearing rather than tidy.
 */
async function runWeeklyStep(tenantMeta, env) {
  try {
    return await registry.withTenantConnection(tenantMeta, env, (c) =>
      weeklyStep(c, { tenant: tenantMeta.slug, env }));
  } catch (err) {
    logger.error(
      { tenant: tenantMeta.slug, env, err: err && err.message },
      "[attendance] weekly lateness summary failed — the day is still reconciled",
    );
    return null;
  }
}

module.exports = async function attendanceReconcile(job) {
  const { tenantMeta, env = "live", date = null } = job.data || {};
  if (!tenantMeta) throw new Error("attendance-reconcile job needs tenantMeta");
  const out = await registry.withTenantConnection(tenantMeta, env, (c) => reconcile.reconcileDate(c, { date }));
  logger.info({ tenant: tenantMeta.slug, env, ...out }, "[attendance] day reconciled");
  // AFTER the reconcile has committed, on a connection of its own.
  await runWeeklyStep(tenantMeta, env);
  return out;
};

// Exported for the tests that prove the Monday gate and that a throwing weekly
// writer leaves the reconcile result untouched.
module.exports.weeklyStep = weeklyStep;
module.exports.runWeeklyStep = runWeeklyStep;
