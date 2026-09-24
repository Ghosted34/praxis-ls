/**
 * Worker job: the daily call-record sweep, per tenant and env (sandbox too).
 *
 *   "reprocess"  re-enqueues calls whose transcript failed or whose pipeline
 *                never finished, as `call-transcribe` jobs with origin "sweep".
 *                A sweep run never notifies anyone (audit A4); its drafts wait
 *                in the Calls list. Calls that never connected or have no
 *                recording are NO_RECORDING and are not selected (A5, B5).
 *   "retain"     deletes recorded audio past the tenant's retention window;
 *                transcripts and summaries are kept.
 *
 * Scheduled by src/jobs/call-record-sweep-schedule.js (a working-hours cron).
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const repo = require("../../modules/smartcomm/smartcomm.call.repo");
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

    const failed = await repo.listFailedTranscriptions(c, { limit: 25 });
    const unfinished = await repo.listUntranscribedEndedCalls(c, { limit: 25 });
    const seen = new Set();
    let enqueued = 0;
    for (const call of [...failed, ...unfinished]) {
      if (seen.has(call.call_id)) continue;
      seen.add(call.call_id);
      // `startPipeline` is fire-and-forget by contract: a queue outage here
      // costs one day, and the next tick tries again.
      await pipeline.startPipeline({
        callId: call.call_id, tenantMeta, env, delayMs: 0, origin: "sweep",
      });
      enqueued += 1;
    }
    if (enqueued) {
      logger.info(
        { env, tenant: tenantMeta.slug, failed: failed.length, unfinished: unfinished.length, enqueued },
        "call record sweep: reprocessing",
      );
    }
    return { failed: failed.length, unfinished: unfinished.length, enqueued };
  });
};
