/**
 * Worker job: monthly leave-accrual fan-out tick (MOD-15). Enumerates active
 * tenants and enqueues one `leave-accrual` job per tenant environment, so each
 * tenant accrues on its own connection — isolated and retryable.
 *
 * ── WHY THIS ONE RUNS IN SANDBOX TOO ───────────────────────────────────────
 *
 * The FX scheduler is live-only because it spends a metered external quota on
 * data that is the same for everybody. This spends nothing outside the tenant's
 * own database, and a Test environment where every balance is zero cannot be
 * used to rehearse a leave request — which is precisely what Test is for.
 *
 * Per-environment jobId dedupes an in-flight run, so a slow tenant never piles
 * up duplicate jobs. Duplicates would be harmless anyway (see the handler's
 * idempotency), but a queue that grows on every tick is its own problem.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function leaveAccrualScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    const envs = meta.sandbox_schema ? ["live", "sandbox"] : ["live"];
    for (const env of envs) {
      await enqueue(
        "leave-accrual",
        "accrue",
        { tenantMeta: meta, env },
        { jobId: `leaveaccrual:${meta.db_name}:${env}`, attempts: 2, removeOnComplete: true, removeOnFail: true },
      );
      enqueued += 1;
    }
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[leave] accrual scheduler tick");
  return { tenants: tenants.length, enqueued };
};
