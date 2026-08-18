/**
 * Worker job: daily sandbox auto-wipe fan-out (G3, PRD §5.5).
 *
 * One job per tenant whose `sandbox_wipe_days` is configured (> 0) and whose
 * sandbox is older than that window — the same per-tenant cadence shape as the
 * leave-accrual and attendance-reconcile schedulers. A tenant with
 * `sandbox_wipe_days = 0` (or NULL) keeps its sandbox forever: the tenant's
 * explicit choice, not the scheduler's.
 *
 * Deduped by jobId per tenant per day, so a re-run of the tick (restart,
 * manual dispatch) never queues two wipes of the same sandbox.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function sandboxWipeScheduler() {
  const tenants = await registry.listActiveTenants();
  const now = Date.now();
  const due = tenants.filter((t) => {
    if (!t.sandbox_schema) return false;
    const days = Number(t.sandbox_wipe_days);
    if (!(days > 0)) return false; // 0 / NULL = tenant keeps its sandbox
    if (!t.last_sandbox_wipe_at) return true; // never wiped → wipe now
    const last = Date.parse(t.last_sandbox_wipe_at);
    if (Number.isNaN(last)) return true;
    return now - last >= days * 86400000;
  });
  let enqueued = 0;
  for (const meta of due) {
    await enqueue(
      "sandbox-wipe",
      "wipe",
      { tenantMeta: meta },
      {
        jobId: `sandboxwipe:${meta.slug}:${new Date().toISOString().slice(0, 10)}`,
        attempts: 2,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    enqueued += 1;
  }
  logger.debug(
    { tenants: tenants.length, due: due.length, enqueued },
    "[sandbox] wipe scheduler tick",
  );
  return { tenants: tenants.length, due: due.length, enqueued };
};
