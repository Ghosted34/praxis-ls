/**
 * Worker job: weekly God-Mode PIN rotation (G24, PRD §8.5).
 *
 * The legacy minted a fresh 6-character token weekly, stored it against the
 * ISO week with expires_at = +7 days, and emailed it to the CEO. This fan-out
 * does the same per tenant: mints a fresh PIN for the CEO, stores the Argon2
 * hash + expiry (purge() refuses anything past it), and delivers the
 * plaintext ONCE through the notification EMAIL channel with a SECURITY
 * category (the one delivery that cannot be turned off by preference).
 *
 * The scheduler itself enqueues one job per tenant; the worker handles each
 * tenant on its own connection. The jobId dedupes per tenant per week.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function godmodePinRotationScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    await enqueue(
      "godmode-pin-rotation",
      "rotate",
      { tenantMeta: meta },
      {
        jobId: `godmodepin:${meta.slug}:${new Date().toISOString().slice(0, 10)}`,
        attempts: 2,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    enqueued += 1;
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[godmode] pin rotation tick");
  return { tenants: tenants.length, enqueued };
};
