/**
 * Error Command Center periodic maintenance.
 *
 * Two jobs on one queue, chosen by `job.name`, because they share a dependency
 * set and neither is heavy enough to justify its own worker:
 *
 *   "purge"    — spec §2.2 retention. Delete groups whose last_seen is older
 *                than 30 days. Daily at 02:00 UTC.
 *   "escalate" — spec §5.3. Evaluate active rules and fire what matches.
 *
 * WHY THE ESCALATION EVALUATOR IS A JOB AND NOT AN ERROR-PATH HOOK
 *
 *   The obvious design is to evaluate rules as each error is persisted. That
 *   inverts the load exactly wrong: during an incident the error rate is at its
 *   peak, so rule evaluation — several indexed aggregate queries per rule —
 *   would run thousands of times a second against a database already under the
 *   stress that caused the incident. The monitoring would become the outage.
 *
 *   On a timer the cost is constant and known regardless of error volume, which
 *   is the property you want from the thing that is supposed to tell you the
 *   system is on fire. The trade is up to `ERROR_ESCALATION_INTERVAL_MS` of
 *   detection latency, which is immaterial next to the deliberate
 *   `escalation_delay_minutes` most rules carry anyway.
 *
 * Both are idempotent and safe to run concurrently on several replicas: purge
 * is a bounded DELETE, and escalation dedupes against error_escalation_log
 * inside the repeat interval.
 */

"use strict";

const { logger } = require("../../config/logger");
const errors = require("../../services/platform/errors.service");
const escalation = require("../../services/platform/error-escalation.service");

module.exports = async function errorMaintenance(job) {
  const kind = job.name || "escalate";

  if (kind === "purge") {
    const result = await errors.purge({ days: errors.RETENTION_DAYS });
    logger.info({ ...result }, "[error-maintenance] retention purge complete");
    return result;
  }

  const result = await escalation.evaluate();
  if (result.fired.length) {
    logger.info({ fired: result.fired.length, rules: result.rules }, "[error-maintenance] escalations fired");
  }
  return result;
};
