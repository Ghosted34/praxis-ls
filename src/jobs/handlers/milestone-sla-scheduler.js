/**
 * Worker job: milestone SLA fan-out tick (MOD-31). Runs on a BullMQ repeat
 * schedule (MILESTONE_SLA_CRON, default 06:00 and 18:00 Douala time) and
 * enqueues one `milestone-sla` job per LIVE tenant, so each tenant's chains are
 * scanned on its own connection.
 *
 * TWICE A DAY, not hourly, and that is a product decision rather than a
 * performance one: the start and the end of a working day are when somebody can
 * actually act on "this file is going to breach". A tenant who wants it hourly
 * changes the cron; the scan itself is idempotent and emits only on health
 * transitions, so running it more often costs noise, not correctness.
 *
 * Live only. Sandbox chains are test data and their alerts would be fiction.
 * Per-tenant jobId dedupes an in-flight scan so a slow tenant never piles up.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function milestoneSlaScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    await enqueue(
      "milestone-sla",
      "scan",
      { tenantMeta: meta, env: "live" },
      { jobId: `mssla:${meta.db_name}:live`, attempts: 2, removeOnComplete: true, removeOnFail: 100 },
    );
    enqueued += 1;
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[milestone] SLA scheduler tick");
  return { tenants: tenants.length, enqueued };
};
