/**
 * Worker job: the call record pipeline (Smart Comms PR-2, guide §4.5).
 *
 * Enqueued twice for one call, on purpose, and both are needed:
 *
 *   1. the ENDED transition — DELAYED, because at that instant the callers'
 *      phones are still flushing 60–120 s parts to the API;
 *   2. the last part upload — immediately, because now there is something to
 *      transcribe and the caller is watching a "transcribing…" state.
 *
 * The queue de-duplicates on the call id (queue-producer's static jobId), so the
 * second enqueue costs nothing while the first is in flight, and the pipeline
 * itself is idempotent by state: a call already CERTIFIED with a draft is left
 * alone, and a run that is still alive is not started twice.
 *
 * ── EVERY EXIT MARKS THE RECORD ────────────────────────────────────────────
 *
 * The one discipline this handler inherits from ai-transcribe.js: whatever
 * happens, the call ends up saying which of the four states it is in. A missing
 * tenantMeta is a CALLER bug (BullMQ would otherwise retry it 5 times and
 * finally drop it silently) so it throws; everything else is a state on the row.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const pipeline = require("../../modules/smartcomm/smartcomm.call.pipeline.service");
const { logger } = require("../../config/logger");

module.exports = async function callTranscribe(job) {
  const { callId, tenantMeta, env = "live", user = null } = job.data || {};
  if (!callId || !tenantMeta || (env !== "live" && env !== "sandbox")) {
    throw new Error("call-transcribe requires callId + a live or sandbox tenant");
  }
  const result = await registry.withTenantConnection(tenantMeta, env, (c) =>
    pipeline.processCall(c, { callId, tenantMeta, env, user, slug: tenantMeta.slug }),
  );
  logger.info({ callId, env, result }, "call-transcribe finished");
  return result;
};
