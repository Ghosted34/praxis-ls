/**
 * Worker job: the daily call-record sweep, per tenant and env (sandbox too).
 *
 *   "reprocess"  restarts only work that never happened: a part whose job
 *                never ran or died, and a finalise that never ran, each within
 *                its cap (pipeline.sweepStalled). A part that failed on both
 *                providers is never retried automatically (owner decision O1).
 *                A sweep run never notifies anyone (audit A4).
 *   "retain"     deletes recorded audio past the tenant's retention window;
 *                transcripts and summaries are kept.
 *
 * Scheduled by src/jobs/call-record-sweep-schedule.js (a working-hours cron).
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const pipeline = require("../../modules/smartcomm/smartcomm.call.pipeline.service");
const callService = require("../../modules/smartcomm/smartcomm.call.service");
const { logger } = require("../../config/logger");

module.exports = async function commsCallRecordSweep(job) {
  const { tenantMeta, env = "live", kind = "reprocess" } = job.data || {};
  if (!tenantMeta || (env !== "live" && env !== "sandbox")) {
    throw new Error("comms-call-record-sweep requires a live or sandbox tenant");
  }

  return registry.withTenantConnection(tenantMeta, env, async (c) => {
    if (kind === "retain") {
      // PR-3: the window is the TENANT's (setting comms.call_recording, seeded
      // by 14020 at D7's 30 days). Read here rather than at boot so a tenant
      // that shortens its window sees the change on the next daily tick, and
      // clamped by callSettings so a typo (900 days, or 0) cannot turn a
      // retention sweep into either a no-op or an accidental purge.
      const { recording_retention_days: days } = await callService.settingsFor(c);
      const result = await pipeline.purgeExpiredAudio(c, { days });
      logger.info({ ...result, days, env, tenant: tenantMeta.slug }, "call audio retention applied");
      return result;
    }

    const result = await pipeline.sweepStalled(c, { tenantMeta, env });
    if (result.parts || result.calls || result.closed) {
      logger.info({ ...result, env, tenant: tenantMeta.slug }, "call record sweep: restarted work that never ran");
    }
    return result;
  });
};
