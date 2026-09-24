"use strict";
/**
 * The call-record jobs carry WHO started a pipeline run (audit A4): the job
 * enqueued at hang-up says "hangup", the daily sweep says "sweep", and only
 * the first may notify anyone.
 */
jest.mock("../../src/services/tenant/registry.service", () => ({
  withTenantConnection: jest.fn(async (meta, env, fn) => fn({ fake: true })),
}));
jest.mock("../../src/modules/smartcomm/smartcomm.call.pipeline.service", () => ({
  processCall: jest.fn(async () => ({ ok: true })),
  startPipeline: jest.fn(async () => ({ id: "job" })),
  purgeExpiredAudio: jest.fn(async () => ({ due: 0, purged: 0, failed: 0 })),
}));
jest.mock("../../src/modules/smartcomm/smartcomm.call.repo", () => ({
  listFailedTranscriptions: jest.fn(async () => [{ call_id: "c-failed" }]),
  listUntranscribedEndedCalls: jest.fn(async () => [{ call_id: "c-unfinished" }, { call_id: "c-failed" }]),
}));

const pipeline = require("../../src/modules/smartcomm/smartcomm.call.pipeline.service");
const callTranscribe = require("../../src/jobs/handlers/call-transcribe");
const recordSweep = require("../../src/jobs/handlers/comms-call-record-sweep");

const tenantMeta = { slug: "acme", db_name: "acme" };

test("the transcribe job hands its origin to processCall", async () => {
  await callTranscribe({ data: { callId: "c1", tenantMeta, env: "live", origin: "sweep" } });
  expect(pipeline.processCall.mock.calls[0][1]).toEqual(expect.objectContaining({ callId: "c1", origin: "sweep" }));
});

test("a job queued before this change (no origin) is treated as a hang-up", async () => {
  await callTranscribe({ data: { callId: "c1", tenantMeta, env: "live" } });
  expect(pipeline.processCall.mock.calls[0][1].origin).toBe("hangup");
});

test("the daily sweep enqueues every retry as origin sweep, once per call", async () => {
  const out = await recordSweep({ data: { tenantMeta, env: "live", kind: "reprocess" } });
  expect(out.enqueued).toBe(2);
  expect(pipeline.startPipeline).toHaveBeenCalledTimes(2);
  for (const [args] of pipeline.startPipeline.mock.calls) expect(args.origin).toBe("sweep");
});
