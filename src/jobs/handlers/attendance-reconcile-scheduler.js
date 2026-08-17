/**
 * Worker job: nightly attendance-reconcile fan-out (0697). One job per tenant
 * environment, each on its own connection.
 *
 * Sandbox included, for the same reason the leave accrual scheduler includes
 * it: this spends nothing outside the tenant's own database, and a Test
 * environment where no day is ever reconciled cannot be used to rehearse the
 * one thing people most want to rehearse — what a lateness costs before
 * switching the rule on for real.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function attendanceReconcileScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    const envs = meta.sandbox_schema ? ["live", "sandbox"] : ["live"];
    for (const env of envs) {
      await enqueue(
        "attendance-reconcile",
        "reconcile",
        { tenantMeta: meta, env },
        { jobId: `attreconcile:${meta.db_name}:${env}`, attempts: 2, removeOnComplete: true, removeOnFail: true },
      );
      enqueued += 1;
    }
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[attendance] reconcile scheduler tick");
  return { tenants: tenants.length, enqueued };
};
