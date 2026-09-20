/**
 * Worker job: the ring push escalation (Smart Comms PR-3, guide §4.6).
 *
 * Queued by `createCall` with a 5-second delay and a static job id, so there is
 * one escalation per ring, and it fires while the 60-second window is still
 * open — never waiting for the socket to be declared dead, because "the socket
 * looks quiet" is exactly the case this channel exists for.
 *
 * ── WHY A JOB AND NOT A TIMER IN THE API PROCESS ────────────────────────────
 *
 * A `setTimeout` in the request would die with the process: a deploy rolling
 * during a ring would lose the second channel silently, and multi-replica
 * deployments would fire one push per replica. BullMQ's delayed job survives
 * both, and its retry semantics are the same ones the transcription pipeline
 * already relies on.
 *
 * ── AND WHY IT RE-READS EVERYTHING ─────────────────────────────────────────
 *
 * The job carries a call id and nothing else that matters. By the time it runs,
 * the call may have been answered, declined, cancelled, swept to NO_ANSWER, or
 * acknowledged on another device — all of which mean "do not push". Those are
 * facts about the row, so the row is asked. That is the difference between an
 * escalation that stops when the bell is heard and one that keeps ringing at
 * somebody who has already picked up.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const callService = require("../../modules/smartcomm/smartcomm.call.service");
const { logger } = require("../../config/logger");

module.exports = async function commsCallRingEscalate(job) {
  const { callId, tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta || (env !== "live" && env !== "sandbox")) {
    throw new Error("comms-call-ring-escalate requires a live or sandbox tenant");
  }
  if (!callId) throw new Error("comms-call-ring-escalate requires a call id");

  const result = await registry.withTenantConnection(tenantMeta, env, (c) =>
    callService.escalateRing(c, { callId, tenantSlug: tenantMeta.slug }),
  );

  // The refusals are the interesting half of this job's output — every one of
  // them is the escalation working correctly (the bell was heard, or the call
  // moved on). Logged at debug so a busy deployment is not 100 lines an hour
  // saying "nothing happened", while the one line that means a push went out
  // stays at info inside the service.
  if (!result.pushed) {
    logger.debug({ callId, reason: result.reason }, "call: ring push not escalated");
  }
  return result;
};
