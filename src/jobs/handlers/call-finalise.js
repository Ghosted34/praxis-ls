/**
 * Worker job: assemble a call's transcript, draft its summary and tell the
 * caller once (smartcomm.call.pipeline.service.finaliseCall).
 *
 * Enqueued when both sides have declared and every declared part has a result
 * (jobId callfinal-<call>), at hang-up as the ended_at + 10 min deadline
 * (callfinaldl-<call>, `deadline: true`), and by the record sweep for a
 * finalise that never ran (origin "sweep", which never notifies: audit A4).
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const pipeline = require("../../modules/smartcomm/smartcomm.call.pipeline.service");
const { logger } = require("../../config/logger");

module.exports = async function callFinalise(job) {
  const {
    callId, tenantMeta, env = "live", origin = "upload", deadline = false, user = null,
  } = job.data || {};
  if (!callId || !tenantMeta || (env !== "live" && env !== "sandbox")) {
    throw new Error("call-finalise requires callId + a live or sandbox tenant");
  }
  const withDb = (fn) => registry.withTenantConnection(tenantMeta, env, fn);
  const result = await pipeline.finaliseCall({
    withDb, callId, tenantMeta, env, origin, deadline: deadline === true, user,
  });
  logger.info({ callId, env, origin, deadline, result }, "call-finalise finished");
  return result;
};
