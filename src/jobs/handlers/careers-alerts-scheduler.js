/**
 * Worker job: careers job-alert fan-out (13792). One job per tenant.
 *
 * LIVE only, for `contract-lapse-scheduler`'s reason in a sharper form: this
 * one writes to STRANGERS. A rehearsal vacancy mailed to a real candidate is a
 * job that does not exist, advertised to somebody who will apply for it.
 *
 * The public base URL is resolved HERE rather than in the worker, because it is
 * a PLATFORM read and the worker is already inside a tenant connection — and
 * because a tenant with no host on file should cost one lookup at fan-out
 * rather than a job that starts, opens a pool and then discovers it cannot
 * send anything.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function careersAlertsScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  let skipped = 0;
  for (const meta of tenants) {
    const baseUrl = await registry.publicSiteBaseUrl(meta.tenant_id).catch(() => null);
    if (!baseUrl) {
      // Not an error: a tenant can be LIVE on the ERP with no public site at
      // all. It is logged at debug rather than warn for exactly that reason —
      // a warning every tick for a tenant that is working as intended is how a
      // log stops being read.
      skipped += 1;
      logger.debug({ tenant: meta.db_name }, "[careers] no public host — alert fan-out skipped");
      continue;
    }
    await enqueue(
      "careers-alerts",
      "digest",
      { tenantMeta: { ...meta, public_base_url: baseUrl }, env: "live" },
      { jobId: `careersalerts:${meta.db_name}:live`, attempts: 2, removeOnComplete: true, removeOnFail: true },
    );
    enqueued += 1;
  }
  logger.debug({ tenants: tenants.length, enqueued, skipped }, "[careers] alert scheduler tick");
  return { tenants: tenants.length, enqueued, skipped };
};
