/**
 * Worker job: media reconciliation tick. One `media-reconcile` per LIVE tenant.
 *
 * The interval is MEDIA_RECONCILE_INTERVAL_MS (default 15 minutes, 0
 * disables). The TTL that decides when an orphan is old enough to sweep is
 * the service's own (24 hours) — much longer than the interval, so several
 * ticks see a fresh orphan and deliberately leave it alone: a replacement in
 * flight, a retried PATCH and a dead upload are byte-identical until time
 * passes.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function mediaReconcileScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    await enqueue(
      "media-reconcile",
      "sweep",
      { tenantMeta: meta, env: "live" },
      { jobId: `mediareconcile:${meta.db_name}:live`, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
    enqueued += 1;
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[media] reconciliation scheduler tick");
  return { tenants: tenants.length, enqueued };
};
