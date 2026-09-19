/**
 * Worker job: tax obligation fan-out tick (MOD-01, PR-05). Enumerates active
 * tenants and enqueues one `tax-obligation` job per tenant environment, so each
 * tenant generates on its own connection — isolated and retryable.
 *
 * ── WHY PER ENVIRONMENT ────────────────────────────────────────────────────
 *
 * Same split `leave-accrual-scheduler` and `workspace-reminder-scheduler` make,
 * and for the reason the latter states: a filing calendar that only ever
 * generates in LIVE cannot be verified until it has already generated. A tenant
 * adding a tax registration in Test and seeing the filings appear is the only
 * way anybody finds out the cadence rule is wrong before an accountant does.
 *
 * ── WHY THE jobId IS PER TENANT AND ENVIRONMENT ────────────────────────────
 *
 * So a tick that overlaps its predecessor cannot stack two runs of the same
 * tenant. Duplicates would be harmless anyway — that is the whole point of the
 * generation key and the reminder watermark — but a queue that grows on every
 * tick is its own problem, and deduping is one line.
 *
 * Job data enqueued: { tenantMeta, env }.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function taxObligationScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    // `sandbox_schema` is what `leave-accrual-scheduler` checks: a tenant with
    // no sandbox has nothing to sweep there, and enqueueing a job that opens a
    // non-existent schema only produces a failure in the queue for someone to
    // go and read.
    const envs = meta.sandbox_schema ? ["live", "sandbox"] : ["live"];
    for (const env of envs) {
      await enqueue(
        "tax-obligation",
        "generate",
        { tenantMeta: meta, env },
        { jobId: `taxobligation:${meta.db_name}:${env}`, attempts: 2, removeOnComplete: true, removeOnFail: true },
      );
      enqueued += 1;
    }
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[mod01] tax obligation scheduler tick");
  return { tenants: tenants.length, enqueued };
};
