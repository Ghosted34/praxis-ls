/**
 * Health sampling job — the producer behind the Overview widget's uptime figure
 * (spec §8.2, acceptance criterion #12).
 *
 * One job name, two behaviours, matching error-maintenance's shape:
 *
 *   "sample" — probe Postgres and Redis, write one platform.health_sample row.
 *              Every HEALTH_SAMPLE_INTERVAL_MS.
 *   "purge"  — 30-day retention for the samples and 90-day for READ
 *              notifications. Daily, alongside the error purge.
 *
 * WHY THE COLLECTOR IS A JOB AND NOT A setInterval IN THE API PROCESS
 *
 *   An interval inside the API would be per-replica: three API containers would
 *   write three samples a minute, the uptime denominator would be wrong by a
 *   factor of three, and the figure would silently change every time the
 *   deployment scaled. The worker is singular by deployment convention, so the
 *   sample rate matches the interval the uptime maths assumes.
 *
 *   The cost is that this measures the WORKER's view of the platform, not each
 *   API replica's. That is the right trade for this number — see
 *   services/platform/health.service.js for why "the worker could not reach
 *   Postgres" and "the platform was down" are deliberately the same answer here.
 *
 * NEVER THROWS. A failed probe is a DATA POINT, not an error: the whole purpose
 * of this job is to record that things were broken. Letting it reject would put
 * the job on BullMQ's retry/backoff path and skip the very samples that make an
 * outage visible.
 */

"use strict";

const { logger } = require("../../config/logger");
const health = require("../../services/platform/health.service");
const notifications = require("../../services/platform/notifications.service");

module.exports = async function healthCollect(job) {
  const kind = job.name || "sample";

  if (kind === "purge") {
    const samples = await health.purge({ days: health.RETENTION_DAYS });
    // Notifications are purged here rather than in error-maintenance because
    // they outlive the errors that produced them: a 90-day read-notification
    // window against a 30-day error window means "what was I told about in
    // March" survives the error group being gone, which is what an audit trail
    // is for.
    const notes = await notifications.purge({ days: 90 });
    logger.info({ samples, notifications: notes }, "[health-collect] retention purge complete");
    return { samples, notifications: notes };
  }

  const result = await health.sample();

  // Only log the bad ones. A line a minute saying "everything is fine" is how a
  // log becomes something nobody reads, and this job runs 1,440 times a day.
  if (!result.healthy) {
    logger.warn({ components: result.components }, "[health-collect] platform unhealthy");
  }

  return result;
};
