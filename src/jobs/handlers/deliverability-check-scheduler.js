/**
 * Daily fan-out: one deliverability check per LIVE tenant. Sandbox has no
 * real sending domains worth paging anyone about.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function deliverabilityCheckScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    await enqueue(
      "deliverability-check",
      "check",
      { tenantMeta: meta, env: "live" },
      { jobId: `deliverability:${meta.db_name}:live`, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
    enqueued += 1;
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[mail] deliverability scheduler tick");
  return { tenants: tenants.length, enqueued };
};
