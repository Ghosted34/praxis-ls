/**
 * Call metrics job (Smart Comms PR-3, guide §7.2).
 *
 * One job name, three behaviours, matching health-collect's shape:
 *
 *   "aggregate"  rebuild the last seven days of every tenant's call metrics.
 *                Daily, 00:20 UTC.
 *   "alert"      refresh TODAY and evaluate the sustained-transcription-failure
 *                alarm. Hourly.
 *   "purge"      the 400-day retention for the metric rows. Daily, with the
 *                aggregation.
 *
 * ── WHY "TODAY" IS REFRESHED BY THE ALERT TICK ──────────────────────────────
 *
 * A daily aggregation alone would make the alarm up to a day stale, and the
 * thing it watches is a caller being told their transcript is coming when it is
 * not. So the hourly tick re-aggregates from the start of today — a small,
 * bounded read — and then evaluates. The 7-day pass in the daily tick is what
 * repairs a window in which the worker was down; the hourly pass is what makes
 * the alarm current.
 *
 * ── NEVER THROWS ON A TENANT'S BEHALF ───────────────────────────────────────
 *
 * `aggregateFleet` collects per-tenant failures and carries on: a metrics job
 * that dies on the first unreachable tenant produces no metrics for anybody,
 * exactly when somebody is looking. The job returns `{errors}` so the failure
 * is visible in the job result rather than only in a log line.
 *
 * Whether a tenant's data is in here at all is separately visible and
 * deliberately so: a tenant whose last `computed_at` is old is a row the
 * console renders as stale, not a gap it quietly averages over.
 */
"use strict";

const metrics = require("../../services/platform/comms-metrics.service");
const { logger } = require("../../config/logger");

module.exports = async function commsCallMetrics(job) {
  const kind = (job && job.name) || "aggregate";

  if (kind === "purge") {
    const result = await metrics.purge({ days: metrics.RETENTION_DAYS });
    logger.info(result, "[comms-call-metrics] retention purge complete");
    return result;
  }

  if (kind === "alert") {
    // Today's rows first: the alarm reads the aggregated table, so evaluating
    // before refreshing would page on yesterday's numbers with today's date on
    // them. One day back, not seven — the daily tick owns the repair window.
    const refreshed = await metrics.aggregateFleet({ days: 1 });
    const decision = await metrics.evaluateTranscriptionAlert();
    if (decision.raised.length) {
      logger.warn({ raised: decision.raised, ...decision }, "[comms-call-metrics] sustained transcription failure");
    }
    return { refreshed, decision };
  }

  const result = await metrics.aggregateFleet({ days: metrics.REGRESSION_DAYS });
  const purged = await metrics.purge({ days: metrics.RETENTION_DAYS });
  logger.info(
    { tenants: result.tenants, rows: result.rows, errors: result.errors.length, purged: purged.deleted },
    "[comms-call-metrics] aggregation complete",
  );
  return { ...result, purged };
};
