/**
 * Worker job: orchestration fan-out tick (Plan A / A5). Runs on a BullMQ repeat
 * schedule; enumerates LIVE tenants and enqueues one `orchestration-dispatch` job
 * per tenant × environment so each tenant's outbox is drained on its own
 * connection (isolated + retryable).
 *
 * Dedupe: a per-(tenant,env) jobId means a tenant that's still draining won't
 * pile up duplicate dispatch jobs; the id frees on completion (removeOnComplete)
 * so the next tick re-enqueues. `live` + `sandbox` are both drained — event_log /
 * event_dispatch are per-schema, and testing the flow happens in sandbox.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

const ENVS = ["live", "sandbox"];

module.exports = async function orchestrationScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    for (const env of ENVS) {
      // eslint-disable-next-line no-await-in-loop
      await enqueue(
        "orchestration-dispatch",
        "dispatch",
        { tenantMeta: meta, env },
        { jobId: `odispatch:${meta.db_name}:${env}`, attempts: 2, removeOnComplete: true, removeOnFail: 100 },
      );
      enqueued += 1;
    }
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[orchestration] scheduler tick");
  return { tenants: tenants.length, enqueued };
};
