"use strict";
/**
 * The call-record jobs (audit PR-2). The part and finalise jobs carry who
 * started them, because only a non-sweep run may notify anyone (A4); the
 * handlers hand the pipeline a `withDb` that opens a connection per call
 * rather than one connection for the whole job (D3); and the daily sweep
 * restarts only work that never ran.
 */
jest.mock("../../src/services/tenant/registry.service", () => ({
  withTenantConnection: jest.fn(async (meta, env, fn) => fn({ fake: true })),
}));
jest.mock("../../src/modules/smartcomm/smartcomm.call.pipeline.service", () => ({
  SIDES: ["caller", "callee"],
  transcribePartJob: jest.fn(async () => ({ status: "OK" })),
  finaliseCall: jest.fn(async () => ({ state: "CERTIFIED" })),
  sweepStalled: jest.fn(async () => ({ parts: 1, closed: 0, calls: 1 })),
  purgeExpiredAudio: jest.fn(async () => ({ due: 0, purged: 0, failed: 0 })),
}));

const registry = require("../../src/services/tenant/registry.service");
const pipeline = require("../../src/modules/smartcomm/smartcomm.call.pipeline.service");
const partJob = require("../../src/jobs/handlers/call-transcribe-part");
const finaliseJob = require("../../src/jobs/handlers/call-finalise");
const recordSweep = require("../../src/jobs/handlers/comms-call-record-sweep");

const tenantMeta = { slug: "acme", db_name: "acme" };

beforeEach(() => jest.clearAllMocks());

test("the part job passes its part and origin, and a withDb that opens a connection per use", async () => {
  await partJob({ data: { callId: "c1", side: "caller", partIndex: 2, tenantMeta, env: "sandbox", origin: "manual" } });
  const args = pipeline.transcribePartJob.mock.calls[0][0];
  expect(args).toEqual(expect.objectContaining({ callId: "c1", side: "caller", partIndex: 2, env: "sandbox", origin: "manual" }));
  // Nothing is held open by the handler itself (audit D3).
  expect(registry.withTenantConnection).not.toHaveBeenCalled();
  await args.withDb(async () => {});
  await args.withDb(async () => {});
  expect(registry.withTenantConnection).toHaveBeenCalledTimes(2);
  expect(registry.withTenantConnection.mock.calls[0][1]).toBe("sandbox");
});

test("the part job refuses a job with no side or part", async () => {
  await expect(partJob({ data: { callId: "c1", tenantMeta, env: "live" } })).rejects.toThrow(/side, partIndex/);
  await expect(partJob({ data: { callId: "c1", side: "both", partIndex: 1, tenantMeta } })).rejects.toThrow();
});

test("the finalise job hands its origin and deadline flag to finaliseCall", async () => {
  await finaliseJob({ data: { callId: "c1", tenantMeta, env: "live", origin: "sweep", deadline: true } });
  expect(pipeline.finaliseCall.mock.calls[0][0]).toEqual(
    expect.objectContaining({ callId: "c1", origin: "sweep", deadline: true }),
  );
});

test("the daily sweep restarts only work that never ran, through the pipeline", async () => {
  const out = await recordSweep({ data: { tenantMeta, env: "live", kind: "reprocess" } });
  expect(out).toEqual({ parts: 1, closed: 0, calls: 1 });
  expect(pipeline.sweepStalled).toHaveBeenCalledWith({ fake: true }, { tenantMeta, env: "live" });
});
