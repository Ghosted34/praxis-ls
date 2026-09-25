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

jest.mock("../../src/config/redis", () => {
  const fake = require("../helpers/fake-redis").createFakeRedis();
  return { getClient: () => fake, __fake: fake };
});
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: jest.fn(async () => ({ id: "j" })) }));
jest.mock("../../src/services/tenant/registry.service", () => ({
  withTenantConnection: jest.fn(async (meta, env, fn) => fn({ fake: true })),
  listActiveTenants: jest.fn(async () => []),
}));

const { DelayedError } = require("bullmq");
const fakeRedis = require("../../src/config/redis").__fake;
const registry = require("../../src/services/tenant/registry.service");
const pipeline = require("../../src/modules/smartcomm/smartcomm.call.pipeline.service");
const partJob = require("../../src/jobs/handlers/call-transcribe-part");
const finaliseJob = require("../../src/jobs/handlers/call-finalise");
const recordSweep = require("../../src/jobs/handlers/comms-call-record-sweep");

const tenantMeta = { slug: "acme", db_name: "acme" };

beforeEach(() => {
  jest.clearAllMocks();
  fakeRedis._reset();
  require("../../src/modules/smartcomm/smartcomm.call.gate").resetLocalForTests();
});

function bullJob(data) {
  const job = {
    id: `callpart-${data.callId}-${data.side}-${data.partIndex}`,
    data,
    updateData: jest.fn(async (d) => { job.data = d; }),
    moveToDelayed: jest.fn(async () => {}),
  };
  return job;
}

describe("fair share and limiters in the part job (audit D2)", () => {
  test("past its tenant's burst, a part waits for its reserved slot as a delayed job, not an attempt", async () => {
    const { config } = require("../../src/config/env");
    for (let i = 0; i < config.CALL_TRANSCRIBE_TENANT_BURST; i += 1) {
      await partJob(bullJob({ callId: `c${i}`, side: "caller", partIndex: 1, tenantMeta, env: "live" }), "tok");
    }
    const job = bullJob({ callId: "late", side: "caller", partIndex: 1, tenantMeta, env: "live" });
    await expect(partJob(job, "tok")).rejects.toBeInstanceOf(DelayedError);
    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "tok");
    expect(job.data.slotAt).toBeGreaterThan(Date.now());
    expect(pipeline.transcribePartJob).toHaveBeenCalledTimes(config.CALL_TRANSCRIBE_TENANT_BURST);

    // When the delayed job runs, it holds its slot and goes straight on.
    await partJob(job, "tok");
    expect(pipeline.transcribePartJob).toHaveBeenCalledTimes(config.CALL_TRANSCRIBE_TENANT_BURST + 1);
  });

  test("another tenant's part is not held behind the busy one", async () => {
    const { config } = require("../../src/config/env");
    for (let i = 0; i < config.CALL_TRANSCRIBE_TENANT_BURST + 30; i += 1) {
      await partJob(bullJob({ callId: `c${i}`, side: "caller", partIndex: 1, tenantMeta, env: "live" }), "tok").catch(() => {});
    }
    const other = bullJob({ callId: "o1", side: "caller", partIndex: 1, tenantMeta: { slug: "beta", db_name: "beta" }, env: "live" });
    await partJob(other, "tok");
    expect(other.moveToDelayed).not.toHaveBeenCalled();
  });

  test("when both provider limiters are full the job waits to the next window, keeping its slot", async () => {
    pipeline.transcribePartJob.mockResolvedValueOnce({ deferred: true, retryInMs: 12_000 });
    const job = bullJob({ callId: "c1", side: "caller", partIndex: 1, tenantMeta, env: "live" });
    await expect(partJob(job, "tok")).rejects.toBeInstanceOf(DelayedError);
    const [[until]] = job.moveToDelayed.mock.calls;
    expect(until - Date.now()).toBeGreaterThan(11_000);
    expect(job.data.slotAt).toBeTruthy();
  });

  test("a finished part leaves the tenant's waiting list", async () => {
    const signals = require("../../src/modules/smartcomm/smartcomm.call.signals");
    await signals.partQueued({ slug: "acme", env: "live", jobId: "callpart-c9-caller-1" });
    await partJob(bullJob({ callId: "c9", side: "caller", partIndex: 1, tenantMeta, env: "live" }), "tok");
    expect(await fakeRedis.zcard("praxis:calltx:waiting:acme:live")).toBe(0);
  });
});

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

test("the part job's connections go through the tenant's background slots (pool budget)", async () => {
  const slots = require("../../src/jobs/tenant-db-slots");
  let seen = null;
  pipeline.transcribePartJob.mockImplementationOnce(async ({ withDb }) => {
    await withDb(async () => { seen = slots.inUse("acme"); });
    return { status: "OK" };
  });
  await partJob(bullJob({ callId: "c1", side: "caller", partIndex: 1, tenantMeta, env: "live" }), "tok");
  expect(seen).toBe(1);
  expect(slots.inUse("acme")).toBe(0);
});

test("the call workers' concurrency comes from configuration (§4 item 5)", () => {
  const { config } = require("../../src/config/env");
  expect(config.CALL_TRANSCRIBE_CONCURRENCY).toBe(8);
  expect(config.CALL_FINALISE_CONCURRENCY).toBe(4);
  expect(config.COMMS_CALL_CLOCK_CONCURRENCY).toBe(8);
  const src = require("fs").readFileSync(require.resolve("../../src/jobs/workers.js"), "utf8");
  expect(src).toMatch(/name: "call-transcribe-part", concurrency: config\.CALL_TRANSCRIBE_CONCURRENCY/);
  expect(src).toMatch(/name: "call-finalise", concurrency: config\.CALL_FINALISE_CONCURRENCY/);
  expect(src).toMatch(/name: "comms-call-clock", concurrency: config\.COMMS_CALL_CLOCK_CONCURRENCY/);
});
