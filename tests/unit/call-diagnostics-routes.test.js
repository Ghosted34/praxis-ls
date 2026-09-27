"use strict";
/**
 * Test calls at the HTTP layer (calls audit PR-7, O5): every diagnostics route
 * needs the Test right on MOD-64 — Read, Create or any other right is not
 * enough — and the daily cap reaches the client as a 429 carrying the time the
 * next run is available.
 */
const express = require("express");
const request = require("supertest");

jest.mock("../../src/middleware/auth", () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { user_id: "11111111-1111-1111-1111-111111111111" };
    next();
  },
}));
// A grant list per request, checked exactly as requirePermission would.
jest.mock("../../src/middleware/rbac", () => {
  const { AppError } = jest.requireActual("../../src/utils/errors");
  return {
    requirePermission: (mod, action) => (req, _res, next) => {
      const held = String(req.headers["x-grants"] || "").split(",");
      return held.includes(`${mod}:${action}`)
        ? next()
        : next(new AppError("PERMISSION_DENIED", `No permission for ${mod}.${action}`, 403));
    },
    readPermissions: async () => [],
  };
});
jest.mock("../../src/middleware/feature-gate", () => ({ requireFeature: () => (_req, _res, next) => next() }));
jest.mock("rate-limit-redis", () => {
  const { MemoryStore } = jest.requireActual("express-rate-limit");
  return {
    RedisStore: class {
      constructor() { this.m = new MemoryStore(); }
      init(o) { this.m.init(o); }
      increment(k) { return this.m.increment(k); }
      decrement(k) { return this.m.decrement(k); }
      resetKey(k) { return this.m.resetKey(k); }
    },
  };
});
jest.mock("../../src/config/redis", () => ({ getClient: () => ({ call: jest.fn() }) }));

const rateLimit = require("../../src/shared/http/rate-limit");
const diagnostics = require("../../src/modules/smartcomm/smartcomm.diagnostics.service");
const { AppError } = require("../../src/utils/errors");
const { router } = require("../../src/modules/smartcomm/smartcomm.routes");
const { errorHandler } = require("../../src/middleware/error-handler");

const RUN = "66666666-6666-6666-6666-666666666666";

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.tenant = { slug: "acme" };
    req.env = "live";
    const db = (fn) => fn({ query: async () => ({ rows: [] }) });
    req.tenantDb = db;
    req.identityDb = db;
    next();
  });
  a.use(router);
  a.use(errorHandler);
  return a;
}

beforeAll(() => rateLimit.initRateLimitStore());
beforeEach(() => {
  jest.spyOn(diagnostics, "startRun").mockResolvedValue({ run_id: RUN, status: "RUNNING", steps: [] });
  jest.spyOn(diagnostics, "listRuns").mockResolvedValue({ runs: [], cap: { limit: 3, used: 0 } });
  jest.spyOn(diagnostics, "getRun").mockResolvedValue({ run_id: RUN });
});
afterEach(() => jest.restoreAllMocks());

const ROUTES = [
  ["get", "/diagnostics/runs"],
  ["post", "/diagnostics/runs"],
  ["get", `/diagnostics/runs/${RUN}`],
  ["post", `/diagnostics/runs/${RUN}/signal`],
  ["post", `/diagnostics/runs/${RUN}/ring`],
  ["get", `/diagnostics/runs/${RUN}/ice`],
  ["put", `/diagnostics/runs/${RUN}/steps/audio`],
  ["post", `/diagnostics/runs/${RUN}/parts`],
  ["post", `/diagnostics/runs/${RUN}/finish`],
];

describe("the Test right gates every diagnostics route", () => {
  test.each(ROUTES)("%s %s is 403 with every right on MOD-64 but Test", async (method, path) => {
    const all = ["view", "create", "edit", "delete", "approve", "export", "validate", "disburse"].map((a) => `MOD-64:${a}`).join(",");
    const res = await request(app())[method](path).set("x-grants", all).send({});
    expect(res.status).toBe(403);
  });

  test("with Test, a run starts", async () => {
    const res = await request(app()).post("/diagnostics/runs").set("x-grants", "MOD-64:test").send({});
    expect(res.status).toBe(201);
    expect(res.body.data.run_id).toBe(RUN);
  });

  test("the cap is a 429 with the next available time", async () => {
    diagnostics.startRun.mockRejectedValue(new AppError("DIAGNOSTICS_DAILY_CAP", "Limited to 3 runs a day", 429, {
      next_available_at: "2026-09-26T00:00:00.000Z", limit: 3,
    }));
    const res = await request(app()).post("/diagnostics/runs").set("x-grants", "MOD-64:test").send({});
    expect(res.status).toBe(429);
    expect(JSON.stringify(res.body)).toMatch(/2026-09-26T00:00:00.000Z/);
  });

  test("a device report outside the step shape is refused before the service", async () => {
    const spy = jest.spyOn(diagnostics, "reportStep");
    const res = await request(app()).put(`/diagnostics/runs/${RUN}/steps/audio`).set("x-grants", "MOD-64:test")
      .send({ status: "pass", detail: { blob: "x".repeat(500) } });
    expect(res.status).toBe(422);
    expect(spy).not.toHaveBeenCalled();
  });
});
