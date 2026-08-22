/**
 * Worker job: QES poll backstop, worker half. Ask the provider where every
 * open envelope of one tenant is, and advance the ones that moved.
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §7.4 step 6.
 *
 * ── THE ENVELOPES IT LOOKS AT ──────────────────────────────────────────────
 * Non-terminal and older than an hour. The hour is the handshake window:
 * an envelope created five minutes ago is mid-create, and a poll that asks
 * the provider about it during that window reads a "not found" as a
 * failure. After an hour, a webhook that has not arrived is a webhook that
 * is lost, and the provider's answer is the source of truth.
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 * It does not create envelopes, cancel them, or charge anything. Creation
 * and charging belong to the handoff (one transaction, one place); the poll
 * only advances state the provider already decided. A poll that writes money
 * is a poll that double-charges on a retry.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");

module.exports = async function qesPoll(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta) throw new Error("qes-poll needs tenantMeta");
  if (env !== "live") throw new Error("qes-poll runs on the live environment only");

  return registry.withTenantConnection(tenantMeta, "live", async (client) => {
    const service = require("../../modules/vault/qes/qes.service");
    return service.pollTenant(client, {
      slug: tenantMeta.slug,
      tenantName: tenantMeta.name || "",
      olderThanHours: 1,
      source: "poll",
    });
  });
};
