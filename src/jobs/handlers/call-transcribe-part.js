/**
 * Worker job: transcribe one recorded part of a call
 * (smartcomm.call.pipeline.service.transcribePartJob).
 *
 * Enqueued when the part is uploaded (origin "upload"), by the record sweep
 * for a part whose job never ran ("sweep"), or by an admin's re-run
 * ("manual"). Owner decision O1: one Groq attempt, then Gemini once, then the
 * part has failed. `attempts: 1` on the queue for the same reason. The tenant
 * connection is taken twice, briefly, and never held while a provider works
 * (audit D3).
 *
 * Fair share first (audit D2): the job reserves its tenant's next slot
 * (smartcomm.call.gate) and, if that slot is in the future, waits for it as a
 * delayed job, once. A part the provider limiters cannot take yet waits the
 * same way. Waiting is not an attempt: no provider has been called.
 */
"use strict";

const { DelayedError } = require("bullmq");
const registry = require("../../services/tenant/registry.service");
const { withTenantSlot } = require("../tenant-db-slots");
const pipeline = require("../../modules/smartcomm/smartcomm.call.pipeline.service");
const gate = require("../../modules/smartcomm/smartcomm.call.gate");
const signals = require("../../modules/smartcomm/smartcomm.call.signals");
const { logger } = require("../../config/logger");

async function wait(job, token, ms, patch) {
  await job.updateData({ ...job.data, ...patch });
  await job.moveToDelayed(Date.now() + ms, token);
  throw new DelayedError();
}

function redisOrNull() {
  try {
    return require("../../config/redis").getClient();
  } catch {
    /* @silent:storage — reserveTenantSlot falls back to its in-process bucket. */
    return { watch: async () => { throw new Error("redis not initialised"); } };
  }
}

module.exports = async function callTranscribePart(job, token) {
  const { callId, side, partIndex, tenantMeta, env = "live", origin = "upload", slotAt = null, queuedAt = null } = job.data || {};
  if (!callId || !tenantMeta || !pipeline.SIDES.includes(side) || !(Number(partIndex) >= 1)
      || (env !== "live" && env !== "sandbox")) {
    throw new Error("call-transcribe-part requires callId, side, partIndex + a live or sandbox tenant");
  }
  if (!slotAt) {
    const ms = await gate.reserveTenantSlot(redisOrNull(), { slug: tenantMeta.slug });
    if (ms > 0) await wait(job, token, ms, { slotAt: Date.now() + ms });
  }
  // At most TENANT_POOL_MAX - 2 of the tenant's connections (tenant-db-slots).
  const withDb = (fn) => withTenantSlot(tenantMeta.slug, () => registry.withTenantConnection(tenantMeta, env, fn));
  let result;
  try {
    result = await pipeline.transcribePartJob({
      withDb, callId, side, partIndex: Number(partIndex), tenantMeta, env, origin,
    });
  } catch (err) {
    await signals.partDone({ slug: tenantMeta.slug, env, jobId: job.id, queuedAt });
    throw err;
  }
  if (result && result.deferred) {
    logger.debug({ callId, side, partIndex, retryInMs: result.retryInMs }, "call-transcribe-part: provider limiters full, waiting");
    await wait(job, token, result.retryInMs, { slotAt: slotAt || Date.now() });
  }
  await signals.partDone({ slug: tenantMeta.slug, env, jobId: job.id, queuedAt });
  logger.info({ callId, side, partIndex, env, origin, result }, "call-transcribe-part finished");
  return result;
};
