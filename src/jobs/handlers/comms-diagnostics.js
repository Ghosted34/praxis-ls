/**
 * Worker job: Comms → Setup → Test calls (calls audit PR-7, O5).
 *
 *   "roundtrip"  step 1 (a job through the real queue and worker) and step 3
 *                (the worker's live signal to the runner's screen)
 *   "pipeline"   steps 9–11: the transcription and summary providers, each
 *                forced in turn, and the clean-up of the run's audio
 *
 * The run row lives in the LIVE schema; usage is recorded in the environment
 * being tested. One attempt: a test that retried itself would hide the very
 * failure it exists to show.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { withTenantSlot } = require("../tenant-db-slots");
const diagnostics = require("../../modules/smartcomm/smartcomm.diagnostics.service");
const { logger } = require("../../config/logger");

module.exports = async function commsDiagnostics(job) {
  const { runId, tenantMeta, env = "live", userId, enqueuedAt } = job.data || {};
  if (!runId || !tenantMeta || !userId || (env !== "live" && env !== "sandbox")) {
    throw new Error("comms-diagnostics requires runId, userId + a live or sandbox tenant");
  }
  const withDb = (scope) => (fn) =>
    withTenantSlot(tenantMeta.slug, () => registry.withTenantConnection(tenantMeta, scope, fn));
  const args = { withLiveDb: withDb("live"), withEnvDb: withDb(env), runId, userId, tenantMeta, env };
  const result = job.name === "pipeline"
    ? await diagnostics.pipelineJob(args)
    : await diagnostics.roundtripJob({ ...args, enqueuedAt });
  logger.info({ runId, kind: job.name, env, result }, "comms-diagnostics finished");
  return result;
};
