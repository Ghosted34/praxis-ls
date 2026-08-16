/**
 * Worker job: contract-lapse fan-out (0700). One job per tenant environment.
 *
 * LIVE only — unlike leave accrual and attendance reconciliation, this one
 * NOTIFIES people. A rehearsal contract in Test expiring would put a warning in
 * a real manager's inbox about an employee who does not exist, which is how a
 * useful alert becomes one everybody filters.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function contractLapseScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    await enqueue(
      "contract-lapse",
      "warn",
      { tenantMeta: meta, env: "live" },
      { jobId: `contractlapse:${meta.db_name}:live`, attempts: 2, removeOnComplete: true, removeOnFail: 100 },
    );
    enqueued += 1;
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[hr_contract] lapse scheduler tick");
  return { tenants: tenants.length, enqueued };
};
