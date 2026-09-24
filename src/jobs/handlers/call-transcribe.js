/**
 * Worker job: the call record pipeline for one call
 * (smartcomm.call.pipeline.service.processCall).
 *
 * Enqueued at hang-up (origin "hangup", delayed while the clients flush their
 * parts) and by the daily sweep (origin "sweep"). The origin decides whether
 * anyone may be notified: a sweep run never notifies (audit A4). A job queued
 * before origins existed is a hang-up job. The queue de-duplicates on the call
 * id, and the pipeline is idempotent by state. A missing tenantMeta is a caller
 * bug and throws; every other exit is a state on the call row.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const pipeline = require("../../modules/smartcomm/smartcomm.call.pipeline.service");
const { logger } = require("../../config/logger");

module.exports = async function callTranscribe(job) {
  const { callId, tenantMeta, env = "live", user = null, origin = "hangup" } = job.data || {};
  if (!callId || !tenantMeta || (env !== "live" && env !== "sandbox")) {
    throw new Error("call-transcribe requires callId + a live or sandbox tenant");
  }
  const result = await registry.withTenantConnection(tenantMeta, env, (c) =>
    pipeline.processCall(c, { callId, tenantMeta, env, user, slug: tenantMeta.slug, origin }),
  );
  logger.info({ callId, env, origin, result }, "call-transcribe finished");
  return result;
};
