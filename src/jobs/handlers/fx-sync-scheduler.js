/**
 * Worker job: FX sync fan-out tick (MOD-08). Runs on a BullMQ repeat schedule
 * (FX_SYNC_CRON, default midnight Douala time); enumerates LIVE tenants and
 * enqueues one `fx-sync` job per tenant so each tenant's rates are refreshed on
 * its own connection (isolated + retryable).
 *
 * Modelled on mail-sync-scheduler. Live only: sandbox holds test data and should
 * not burn the real exchangerate-api quota. Per-tenant jobId dedupes an in-flight
 * sync so a slow provider never piles up duplicate jobs.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function fxSyncScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    await enqueue(
      "fx-sync",
      "sync",
      { tenantMeta: meta, env: "live" },
      { jobId: `fxsync:${meta.db_name}:live`, attempts: 2, removeOnComplete: true, removeOnFail: true },
    );
    enqueued += 1;
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[fx] sync scheduler tick");
  return { tenants: tenants.length, enqueued };
};
