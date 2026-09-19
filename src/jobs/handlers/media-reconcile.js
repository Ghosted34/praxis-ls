/**
 * Worker job: one media-attachment reconciliation pass for one tenant (PR-07,
 * CE-11 + CE-25).
 *
 * What it does — see attachment_outbox.service.reconcile for the phase
 * detail: completes document-scan links whose PATCH never landed, sweeps
 * SITE_MEDIA objects orphaned by a failed owner-pointer commit (archiving the
 * vault row and deleting the parked bytes after the TTL), and closes the
 * outbox bookkeeping those repairs resolve.
 *
 * `attempts: 1` on the enqueue side, for the same reason as the SLA sweep:
 * the pass is idempotent — every action it takes stops matching on the re-run
 * — so a retry buys nothing and a retry storm during an outage would sweep
 * the same orphan once per attempt.
 *
 * LIVE only, like the mail sweeps: this job DELETES storage bytes, and a
 * bug that misjudges an orphan should have to do so where an operator is
 * watching, not in the sandbox a test tenant shares with the same code. The
 * handler honours `env` from job data so an operator can run a deliberate
 * sandbox pass by hand.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const outbox = require("../../modules/vault/document_vault/attachment_outbox.service");

module.exports = async function mediaReconcile(job) {
  const { tenantMeta, env = "live", ttlMs } = job.data || {};
  if (!tenantMeta) throw new Error("media-reconcile job needs tenantMeta");
  const result = await registry.withTenantConnection(tenantMeta, env, (c) =>
    outbox.reconcile(c, ttlMs ? { ttlMs } : {}),
  );
  return { tenant: tenantMeta.slug, env, ...result };
};
