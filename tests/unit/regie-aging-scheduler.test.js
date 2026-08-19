"use strict";

/**
 * The régie aging cron (KB §6.8 step 4).
 *
 * WHY THIS EXISTS. `regie-aging` has been a REGISTERED WORKER since the module
 * shipped (workers.js:27) and nothing ever enqueued it — grep the repo before
 * this change and the only references are the handler itself and two comments
 * in other handlers citing it as the pattern to copy. So the aging step only
 * ran if a human POSTed /regie/age-due, which in practice meant it did not run:
 * an advance past its policy window stayed in 581 indefinitely, and
 * AGED_UNJUSTIFIED — the state Landing A went to the trouble of making
 * reversible — was unreachable by the mechanism meant to produce it.
 *
 * A registered worker with no producer is the quietest possible failure: the
 * queue is healthy, the handler is correct, and the work never happens.
 */

const fs = require("fs");
const path = require("path");

const mockEnqueue = jest.fn();
const mockListActiveTenants = jest.fn();
const mockWithTenantConnection = jest.fn();

jest.mock("../../src/jobs/queue-producer", () => ({
  enqueue: (...a) => mockEnqueue(...a),
}));
jest.mock("../../src/services/tenant/registry.service", () => ({
  listActiveTenants: (...a) => mockListActiveTenants(...a),
  withTenantConnection: (...a) => mockWithTenantConnection(...a),
}));
jest.mock("../../src/config/logger", () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

const scheduler = require("../../src/jobs/handlers/regie-aging-scheduler");

const TENANT_A = { db_name: "tenant_a" };
const TENANT_B = { db_name: "tenant_b", sandbox_schema: "sandbox" };

/** Answer withTenantConnection with a fixed entity list per tenant. */
function entitiesBy(map) {
  mockWithTenantConnection.mockImplementation(async (meta, env, fn) =>
    fn({
      query: async () => ({
        rows: (map[meta.db_name] || []).map((id) => ({ entity_id: id })),
      }),
    }),
  );
}

beforeEach(() => {
  mockEnqueue.mockReset();
  mockListActiveTenants.mockReset();
  mockWithTenantConnection.mockReset();
});

describe("the fan-out", () => {
  test("enqueues one job per entity per tenant", async () => {
    mockListActiveTenants.mockResolvedValue([TENANT_A, TENANT_B]);
    entitiesBy({ tenant_a: ["e1", "e2"], tenant_b: ["e3"] });

    const out = await scheduler();

    expect(out).toEqual({ tenants: 2, enqueued: 3, skipped: 0 });
    expect(mockEnqueue).toHaveBeenCalledTimes(3);
  });

  test("every job carries the entityId the handler demands", async () => {
    // regie-aging throws "needs tenantMeta + entityId" without it, because the
    // reclassification is a JOURNAL ENTRY and a journal entry belongs to one
    // legal entity with its own accounting period. Every other scheduler in
    // this directory passes only { tenantMeta, env }; this one cannot.
    mockListActiveTenants.mockResolvedValue([TENANT_A]);
    entitiesBy({ tenant_a: ["e1"] });

    await scheduler();

    const [queue, name, data] = mockEnqueue.mock.calls[0];
    expect(queue).toBe("regie-aging");
    expect(name).toBe("age");
    expect(data.tenantMeta).toBe(TENANT_A);
    expect(data.entityId).toBe("e1");
  });

  test("the jobId is per tenant, env AND entity, so a tick cannot collide", async () => {
    // Keyed only by tenant, the second entity's job would be deduped away and
    // that entity would never age.
    mockListActiveTenants.mockResolvedValue([TENANT_A]);
    entitiesBy({ tenant_a: ["e1", "e2"] });

    await scheduler();

    const ids = mockEnqueue.mock.calls.map((c) => c[3].jobId);
    expect(ids).toEqual([
      "regieaging:tenant_a:live-e1",
      "regieaging:tenant_a:live-e2",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("LIVE only — a sandbox ledger must not move on its own", async () => {
    // This POSTS journal entries. Aging a rehearsal advance into 4211 would put
    // a real reclassification in the sandbox's books, and a Test environment
    // whose ledger moves by itself is not a rehearsal. Note TENANT_B has a
    // sandbox_schema and still gets one job.
    mockListActiveTenants.mockResolvedValue([TENANT_B]);
    entitiesBy({ tenant_b: ["e3"] });

    await scheduler();

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    for (const call of mockEnqueue.mock.calls) {
      expect(call[2].env).toBe("live");
      expect(call[3].jobId).not.toContain("sandbox");
    }
  });
});

describe("failure isolation", () => {
  test("one unreachable tenant does not stop the others", async () => {
    mockListActiveTenants.mockResolvedValue([TENANT_A, TENANT_B]);
    mockWithTenantConnection.mockImplementation(async (meta, env, fn) => {
      if (meta.db_name === "tenant_a") throw new Error("connection refused");
      return fn({ query: async () => ({ rows: [{ entity_id: "e3" }] }) });
    });

    const out = await scheduler();

    expect(out.skipped).toBe(1);
    expect(out.enqueued).toBe(1);
    expect(mockEnqueue.mock.calls[0][2].entityId).toBe("e3");
  });

  test("a tenant with no entities enqueues nothing rather than a broken job", async () => {
    mockListActiveTenants.mockResolvedValue([TENANT_A]);
    entitiesBy({ tenant_a: [] });

    const out = await scheduler();

    expect(out.enqueued).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe("registration", () => {
  const root = path.join(__dirname, "..", "..");
  const workers = fs.readFileSync(
    path.join(root, "src/jobs/workers.js"),
    "utf8",
  );
  const env = fs.readFileSync(path.join(root, "src/config/env.js"), "utf8");

  test("the scheduler is registered as a worker", () => {
    expect(workers).toContain('name: "regie-aging-scheduler"');
  });

  test("and is actually scheduled — the half that was missing", () => {
    expect(workers).toContain("REGIE_AGING_CRON");
    expect(workers).toMatch(/enqueue\("regie-aging-scheduler", "tick"/);
    expect(workers).toMatch(/repeat: \{ pattern: regieCron/);
  });

  test("an empty cron disables it rather than crashing", () => {
    // Every other scheduler here can be turned off the same way, and
    // POST /regie/age-due still ages on demand.
    expect(workers).toMatch(/if \(!regieCron\)/);
    expect(env).toMatch(/REGIE_AGING_CRON: z\.string\(\)\.default\("[^"]+"\)/);
  });
});
