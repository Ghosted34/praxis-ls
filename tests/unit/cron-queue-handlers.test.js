"use strict";

const mockQueueInstance = {
  getJob: jest.fn(),
  add: jest.fn(),
  close: jest.fn().mockResolvedValue(),
};

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => mockQueueInstance),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(),
  })),
}));

const mockRedisClient = {
  defineCommand: jest.fn(),
  on: jest.fn(),
  quit: jest.fn().mockResolvedValue("OK"),
};

jest.mock("../../src/config/redis", () => ({
  getClient: jest.fn().mockReturnValue(mockRedisClient),
  initRedis: jest.fn().mockResolvedValue(mockRedisClient),
  createConnection: jest.fn().mockReturnValue(mockRedisClient),
  closeRedis: jest.fn().mockResolvedValue(),
}));

const { enqueue } = require("../../src/jobs/queue-producer");
const fxSyncScheduler = require("../../src/jobs/handlers/fx-sync-scheduler");
const fxSync = require("../../src/jobs/handlers/fx-sync");
const currencySync = require("../../src/modules/master/currency/currency.sync");
const { withCronLock } = require("../../src/jobs/cron-lock");
const registry = require("../../src/services/tenant/registry.service");

// Mock dependencies
jest.mock("../../src/services/tenant/registry.service");
jest.mock("../../src/modules/master/currency/currency.sync");

describe("Cron & Queue Handlers - Deduplication & FX Sync", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("queue-producer.js jobId deduplication", () => {
    test("removes completed/failed job with matching jobId before enqueuing new job", async () => {
      const mockFinishedJob = {
        getState: jest.fn().mockResolvedValue("failed"),
        remove: jest.fn().mockResolvedValue(true),
      };
      mockQueueInstance.getJob.mockResolvedValue(mockFinishedJob);
      mockQueueInstance.add.mockResolvedValue({ id: "fxsync:tenant_1:live" });

      const res = await enqueue(
        "fx-sync",
        "sync",
        { tenantMeta: { db_name: "tenant_1" }, env: "live" },
        { jobId: "fxsync:tenant_1:live", attempts: 2, removeOnComplete: true, removeOnFail: true },
      );

      expect(mockQueueInstance.getJob).toHaveBeenCalledWith("fxsync:tenant_1:live");
      expect(mockFinishedJob.getState).toHaveBeenCalled();
      expect(mockFinishedJob.remove).toHaveBeenCalled();
      expect(mockQueueInstance.add).toHaveBeenCalledWith(
        "sync",
        expect.objectContaining({ tenantMeta: { db_name: "tenant_1" }, env: "live" }),
        expect.objectContaining({ jobId: "fxsync:tenant_1:live" }),
      );
      expect(res).toEqual({ id: "fxsync:tenant_1:live" });
    });

    test("preserves active/waiting job for in-flight deduplication", async () => {
      const mockActiveJob = {
        getState: jest.fn().mockResolvedValue("active"),
        remove: jest.fn(),
      };
      mockQueueInstance.getJob.mockResolvedValue(mockActiveJob);
      mockQueueInstance.add.mockResolvedValue({ id: "fxsync:tenant_1:live" });

      await enqueue(
        "fx-sync",
        "sync",
        { tenantMeta: { db_name: "tenant_1" }, env: "live" },
        { jobId: "fxsync:tenant_1:live" },
      );

      expect(mockQueueInstance.getJob).toHaveBeenCalledWith("fxsync:tenant_1:live");
      expect(mockActiveJob.remove).not.toHaveBeenCalled();
      expect(mockQueueInstance.add).toHaveBeenCalled();
    });
  });

  describe("fx-sync-scheduler and fx-sync handler", () => {
    test("fxSyncScheduler enumerates active tenants and enqueues jobs", async () => {
      const tenants = [
        { db_name: "tenant_alpha", slug: "alpha" },
        { db_name: "tenant_beta", slug: "beta" },
      ];
      registry.listActiveTenants.mockResolvedValue(tenants);

      mockQueueInstance.getJob.mockResolvedValue(null);
      mockQueueInstance.add.mockImplementation((name, data, opts) => Promise.resolve({ id: opts.jobId }));

      const result = await fxSyncScheduler();

      expect(registry.listActiveTenants).toHaveBeenCalled();
      expect(result).toEqual({ tenants: 2, enqueued: 2 });
      expect(mockQueueInstance.add).toHaveBeenCalledTimes(2);
    });

    test("fxSync invokes withTenantConnection and currency.sync.syncRates", async () => {
      const jobData = {
        data: {
          tenantMeta: { db_name: "tenant_alpha", slug: "alpha" },
          env: "live",
          base: "XAF",
          quotes: ["USD", "EUR"],
        },
      };

      registry.withTenantConnection.mockImplementation((meta, env, fn) => fn({ fakeClient: true }));
      currencySync.syncRates.mockResolvedValue({
        skipped: false,
        base: "XAF",
        updated: [{ quote: "USD", rate: 0.0016 }],
      });

      const res = await fxSync(jobData);

      expect(registry.withTenantConnection).toHaveBeenCalledWith(
        jobData.data.tenantMeta,
        "live",
        expect.any(Function),
      );
      expect(currencySync.syncRates).toHaveBeenCalledWith(
        { fakeClient: true },
        { base: "XAF", quotes: ["USD", "EUR"] },
      );
      expect(res.skipped).toBe(false);
    });

    test("fxSync throws error if tenantMeta is missing", async () => {
      await expect(fxSync({ data: {} })).rejects.toThrow("fx-sync job needs tenantMeta");
    });
  });

  describe("cron-lock.js alias", () => {
    test("exports withCronLock", () => {
      expect(typeof withCronLock).toBe("function");
    });
  });
});
