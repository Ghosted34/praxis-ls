/**
 * Worker job: the daily call-record sweep (Smart Comms PR-2, §4.5 step 3 + D7).
 *
 * Three jobs in one tick, all of them about records that already exist:
 *
 *   "reprocess"  every call whose transcript fell back to the browser capture,
 *                and every call whose pipeline never finished (a worker died
 *                mid-run, Redis was down at hang-up, the last upload never
 *                arrived). Both are re-enqueued as ordinary `call-transcribe`
 *                jobs — this sweep decides WHAT to retry, never how.
 *
 *   "retain"     the D7 audio window: recorded audio older than 30 days is
 *                deleted; the transcript and the summary are permanent.
 *
 * The reprocess is the half of the never-dies guarantee that makes it a
 * guarantee rather than an apology: a flagged transcript is a temporary state,
 * and when the provider is reachable again the certified version replaces it and
 * the caller is told. `abandoned` is the honest ceiling — a call that has failed
 * twenty times is not coming back on the twenty-first, and the attempt counter is
 * on the row so this is a decision the database can be asked about.
 *
 * Runs in the sandbox schema too (it has calls in it, from training), exactly
 * like comms-call-sweep.
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
        callId: call.call_id, tenantMeta, env, delayMs: 0,
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
