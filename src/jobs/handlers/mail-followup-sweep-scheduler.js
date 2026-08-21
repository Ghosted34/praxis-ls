/**
 * Worker job: follow-up fan-out tick. One `mail-followup-sweep` per LIVE tenant.
 *
 * The per-tenant `jobId` dedupes an in-flight sweep, which matters because the
 * rows are claimed and flipped to FIRED in one statement — two overlapping
 * sweeps are safe but pointless.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function mailFollowupSweepScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    await enqueue(
      "mail-followup-sweep",
      "sweep",
      { tenantMeta: meta, env: "live" },
      { jobId: `mailfollowup:${meta.db_name}:live`, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
    enqueued += 1;
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[mail] follow-up sweep scheduler tick");
  return { tenants: tenants.length, enqueued };
};
