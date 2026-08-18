"use strict";

/**
 * G3 — sandbox auto-wipe scheduler.
 *
 * The daily tick must honour each tenant's `sandbox_wipe_days` window and
 * never enqueue a wipe for a tenant that does not want one. The wipe worker
 * itself (provisioning.wipeSandbox) already has its live-unreachable tests in
 * tenant-provisioning.test.js; here the fan-out + dedupe shape is pinned.
 */

const registry = require("../../src/services/tenant/registry.service");
const { enqueue } = require("../../src/jobs/queue-producer");

jest.mock("../../src/services/tenant/registry.service", () => ({
  listActiveTenants: jest.fn(),
}));
jest.mock("../../src/jobs/queue-producer", () => ({
  enqueue: jest.fn(),
}));

const scheduler = require("../../src/jobs/handlers/sandbox-wipe-scheduler");

function tenant(overrides = {}) {
  return {
    slug: "acme",
    sandbox_schema: "sandbox",
    sandbox_wipe_days: 14,
    last_sandbox_wipe_at: null,
    ...overrides,
  };
}

describe("sandbox-wipe-scheduler (G3)", () => {
  beforeEach(() => {
    registry.listActiveTenants.mockReset();
    enqueue.mockReset();
  });

  it("enqueues a tenant that has never been wiped", async () => {
    registry.listActiveTenants.mockResolvedValue([tenant()]);
    const out = await scheduler();
    expect(out.enqueued).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(
      "sandbox-wipe",
      "wipe",
      expect.objectContaining({ tenantMeta: expect.objectContaining({ slug: "acme" }) }),
      expect.objectContaining({ jobId: expect.stringMatching(/^sandboxwipe:acme:/) }),
    );
  });

  it("skips a tenant whose sandbox is newer than its wipe window", async () => {
    const fresh = tenant({
      last_sandbox_wipe_at: new Date(Date.now() - 1000).toISOString(), // wiped a second ago
    });
    registry.listActiveTenants.mockResolvedValue([fresh]);
    const out = await scheduler();
    expect(out.enqueued).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("wipes a tenant whose sandbox is older than its window", async () => {
    const stale = tenant({
      last_sandbox_wipe_at: new Date(Date.now() - 30 * 86400000).toISOString(), // 30 days ago
    });
    registry.listActiveTenants.mockResolvedValue([stale]);
    const out = await scheduler();
    expect(out.enqueued).toBe(1);
  });

  it("never wipes a tenant with sandbox_wipe_days 0 or NULL", async () => {
    registry.listActiveTenants.mockResolvedValue([
      tenant({ sandbox_wipe_days: 0 }),
      tenant({ sandbox_wipe_days: null }),
    ]);
    const out = await scheduler();
    expect(out.enqueued).toBe(0);
  });

  it("skips a tenant with no sandbox schema", async () => {
    registry.listActiveTenants.mockResolvedValue([
      tenant({ sandbox_schema: null }),
    ]);
    const out = await scheduler();
    expect(out.enqueued).toBe(0);
  });

  it("dedupes by jobId per tenant per day", async () => {
    registry.listActiveTenants.mockResolvedValue([tenant()]);
    await scheduler();
    await scheduler();
    const jobIds = enqueue.mock.calls.map((c) => c[3].jobId);
    expect(new Set(jobIds).size).toBe(1);
  });
});
