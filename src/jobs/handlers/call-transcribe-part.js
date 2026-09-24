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
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const pipeline = require("../../modules/smartcomm/smartcomm.call.pipeline.service");
const { logger } = require("../../config/logger");

module.exports = async function callTranscribePart(job) {
  const { callId, side, partIndex, tenantMeta, env = "live", origin = "upload" } = job.data || {};
  if (!callId || !tenantMeta || !pipeline.SIDES.includes(side) || !(Number(partIndex) >= 1)
      || (env !== "live" && env !== "sandbox")) {
    throw new Error("call-transcribe-part requires callId, side, partIndex + a live or sandbox tenant");
  }
  const withDb = (fn) => registry.withTenantConnection(tenantMeta, env, fn);
  const result = await pipeline.transcribePartJob({
    withDb, callId, side, partIndex: Number(partIndex), tenantMeta, env, origin,
  });
  logger.info({ callId, side, partIndex, env, origin, result }, "call-transcribe-part finished");
  return result;
};
