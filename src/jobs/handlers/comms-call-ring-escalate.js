/**
 * Worker job: the call ring's pushes (calls audit PR-4; O4, A7, A12, A14).
 *
 *   "ring"    one ring push to every device of the callee: alert 0 at dial,
 *             then a re-alert every 15 s while the row still rings (at most
 *             4). Each run re-reads the row, claims its alert, and queues the
 *             next one.
 *   "cancel"  the ring is over (answered, declined, missed, ended): the push
 *             that replaces it on every device.
 *
 * A job rather than a timer in the API process: a deploy mid-ring must not
 * lose the ring, and several replicas must not each send one. The queue keeps
 * its PR-3 name so a job queued across the deploy still runs; a PR-3 job
 * ("escalate") is treated as alert 0.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const callService = require("../../modules/smartcomm/smartcomm.call.service");
const { logger } = require("../../config/logger");

module.exports = async function commsCallRingEscalate(job) {
  const { callId, tenantMeta, env = "live", alert = 0, outcome } = job.data || {};
  if (!tenantMeta || (env !== "live" && env !== "sandbox")) {
    throw new Error("comms-call-ring-escalate requires a live or sandbox tenant");
  }
  if (!callId) throw new Error("comms-call-ring-escalate requires a call id");

  const result = await registry.withTenantConnection(tenantMeta, env, (c) =>
    job.name === "cancel"
      ? callService.ringCancel(c, { callId, outcome, tenantSlug: tenantMeta.slug })
      : callService.ringPush(c, { callId, alert: Number(alert) || 0, tenantSlug: tenantMeta.slug, tenantMeta, env }),
  );

  // A refusal is the ring working (answered, over, already sent): debug only.
  if (!result.pushed) {
    logger.debug({ callId, job: job.name, alert, reason: result.reason }, "call: ring push not sent");
  }
  return result;
};
