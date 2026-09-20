"use strict";
/**
 * Scheduler: fan one `comms-link-unfurl` drain out per tenant that has something
 * to drain.
 *
 * LIVE and the Test sandbox alike (the same `sandbox_schema` test
 * comms-send-scheduler applies), because a link pasted while training on Test
 * should get a card too — and because a preview that only works on Live is a
 * feature nobody can rehearse. One job per tenant, not per URL: the job itself
 * asks the tenant's own schema what is due, which is what keeps a sweep from
 * becoming one query per tenant in the scheduler's process and a fan-out of
 * nothing but empty jobs.
 */
const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");

module.exports = async function commsLinkUnfurlScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const tenantMeta of tenants) {
    const envs = tenantMeta.sandbox_schema ? ["live", "sandbox"] : ["live"];
    for (const env of envs) {
      await enqueue("comms-link-unfurl", "sweep", { tenantMeta, env }, {
        // The jobId is per tenant+env per TICK-ish window, so a scheduler that
        // fires while the previous sweep is still running does not start a second
        // one, and a tenant with nothing due produces a job that returns in a
        // millisecond.
        jobId: `commslink-${tenantMeta.db_name || tenantMeta.slug}-${env}`,
        attempts: 2,
        removeOnComplete: true,
        removeOnFail: 50,
      });
      enqueued += 1;
    }
  }
  return { enqueued };
};
