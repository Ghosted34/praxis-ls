/**
 * Worker job: rewrite a call's summary draft in the other language (the EN/FR
 * toggle), off the request path (calls audit C8). Enqueued by
 * `POST /calls/:id/summary/regenerate` as callregen-<call>-<language>.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { withTenantSlot } = require("../tenant-db-slots");
const pipeline = require("../../modules/smartcomm/smartcomm.call.pipeline.service");
const { logger } = require("../../config/logger");

module.exports = async function callSummaryRegenerate(job) {
  const { callId, language, userId = null, tenantMeta, env = "live" } = job.data || {};
  if (!callId || !language || !tenantMeta || (env !== "live" && env !== "sandbox")) {
    throw new Error("call-summary-regenerate requires callId, language + a live or sandbox tenant");
  }
  // At most TENANT_POOL_MAX - 2 of the tenant's connections (tenant-db-slots).
  const withDb = (fn) => withTenantSlot(tenantMeta.slug, () => registry.withTenantConnection(tenantMeta, env, fn));
  const result = await pipeline.regenerateSummaryJob({ withDb, callId, language, userId, tenantMeta, env });
  logger.info({ callId, language, env, result }, "call-summary-regenerate finished");
  return result;
};
