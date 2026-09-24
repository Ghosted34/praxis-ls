"use strict";
/**
 * Calls audit PR-3, at the HTTP layer: the rate limits on the call routes that
 * ring a person or spend money (C6, C2, C8 and PR-2's part re-run), the
 * retired live-log upload (410), and the regenerate route's 202.
 *
 * The real smartcomm router, the real express-rate-limit, and the real error
 * handler. The Redis store is swapped for express-rate-limit's own memory
 * store; login, permissions and features pass; the services are stubbed.
 */
const express = require("express");
const request = require("supertest");

jest.mock("../../src/middleware/auth", () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { user_id: req.headers["x-user-id"] || "11111111-1111-1111-1111-111111111111" };
    next();
  },
}));
jest.mock("../../src/middleware/rbac", () => ({
  requirePermission: () => (_req, _res, next) => next(),
  readPermissions: async () => [],
}));
jest.mock("../../src/middleware/feature-gate", () => ({
  requireFeature: () => (_req, _res, next) => next(),
}));
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
const calls = require("../../src/modules/smartcomm/smartcomm.call.service");
const pipeline = require("../../src/modules/smartcomm/smartcomm.call.pipeline.service");
const { router } = require("../../src/modules/smartcomm/smartcomm.routes");
const { errorHandler } = require("../../src/middleware/error-handler");

const CALL = "55555555-5555-5555-5555-555555555555";
const G1 = "33333333-3333-3333-3333-333333333333";

function app(tenant = "acme") {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.tenant = { slug: tenant };
    req.env = "live";
    req.tenantDb = (fn) => fn({ query: async () => ({ rows: [] }) });
    next();
  });
  a.use(router);
  a.use(errorHandler);
  return a;
}

beforeAll(() => rateLimit.initRateLimitStore());
beforeEach(() => {
  jest.spyOn(calls, "createCall").mockResolvedValue({ call_id: CALL });
  jest.spyOn(calls, "turnFor").mockResolvedValue({ iceServers: [] });
  jest.spyOn(pipeline, "requestRegenerate").mockImplementation(async (_c, { callId, language }) => ({ call_id: callId, language, queued: true }));
  jest.spyOn(pipeline, "rerunPart").mockResolvedValue({ status: "PENDING" });
});
afterEach(() => jest.restoreAllMocks());

/** The limiter names on one route, from the live Express stack. */
function limitersOn(method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  return layer.route.stack.map((s) => s.handle).filter(rateLimit.isRateLimiter).map((h) => h.praxisRateLimit);
}

describe("the call routes that ring or spend are rate-limited", () => {
  test.each([
    ["post", "/calls", "call-dial"],
    ["post", "/calls/test-ring", "call-test-ring"],
    ["get", "/calls/:id/turn", "call-turn"],
    ["post", "/calls/:id/summary/regenerate", "call-regenerate"],
    ["post", "/calls/:id/recording/:side/:part/rerun", "call-part-rerun"],
  ])("%s %s carries %s", (method, path, name) => {
    expect(limitersOn(method, path)).toEqual([name]);
  });

  test("a dial flood from one caller is 429 after the limit; another caller is unaffected", async () => {
    const a = app("flood-dial");
    const U = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const statuses = [];
    for (let i = 0; i < 10; i += 1) {
      statuses.push((await request(a).post("/calls").set("x-user-id", U).send({ group_id: G1 })).status);
    }
    expect(statuses.slice(0, 8)).toEqual(Array(8).fill(201));
    expect(statuses.slice(8)).toEqual([429, 429]);
    expect(calls.createCall).toHaveBeenCalledTimes(8);
    const other = await request(a).post("/calls").set("x-user-id", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb").send({ group_id: G1 });
    expect(other.status).toBe(201);
  });

  test("regenerate answers 202, and a call's rewrites are limited whoever asks", async () => {
    const a = app("flood-regen");
    const first = await request(a).post(`/calls/${CALL}/summary/regenerate`).send({ language: "fr" });
    expect(first.status).toBe(202);
    expect(first.body.data).toEqual({ call_id: CALL, language: "fr", queued: true });
    await request(a).post(`/calls/${CALL}/summary/regenerate`).send({ language: "en" });
    await request(a).post(`/calls/${CALL}/summary/regenerate`).send({ language: "fr" });
    // Another spelling of the same uuid is the same call's budget.
    const respelled = CALL.toUpperCase().replace(/-/g, "");
    const fourth = await request(a).post(`/calls/${respelled}/summary/regenerate`).set("x-user-id", "cccccccc-cccc-cccc-cccc-cccccccccccc").send({ language: "en" });
    expect(fourth.status).toBe(429);
    expect(pipeline.requestRegenerate).toHaveBeenCalledTimes(3);
  });
});

describe("the retired live-log upload", () => {
  test("answers 410 Gone and stores nothing", async () => {
    const res = await request(app()).post(`/calls/${CALL}/live-log`).send({
      side: "caller", live_segments: Array.from({ length: 20 }, (_, i) => ({ seq: i, text: "x".repeat(2000) })),
    });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe("GONE");
  });
});

describe("B9 at the route: an old client's hang-up reason is accepted and ignored", () => {
  test("a body with reason max_duration reaches the service without it", async () => {
    const spy = jest.spyOn(calls, "hangup").mockResolvedValue({ call_id: CALL, end_reason: "hangup" });
    const res = await request(app()).post(`/calls/${CALL}/hangup`).send({ reason: "max_duration" });
    expect(res.status).toBe(200);
    expect(spy.mock.calls[0][1]).not.toHaveProperty("reason");
  });
});

describe("PR-4: the ringing read and the test ring", () => {
  test("GET /calls/ringing is the ringing read, not a call id", async () => {
    const spy = jest.spyOn(calls, "listRinging").mockResolvedValue([{ call_id: CALL, ring_seconds_left: 40 }]);
    const get = jest.spyOn(calls, "getCall");
    const res = await request(app()).get("/calls/ringing");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ call_id: CALL, ring_seconds_left: 40 }]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
  });

  test("a test ring needs this device's push endpoint, and nothing else", async () => {
    const spy = jest.spyOn(calls, "testRing").mockResolvedValue({ sent: 1, failed: 0, total: 1 });
    const a = app("test-ring-shape");
    expect((await request(a).post("/calls/test-ring").send({})).status).toBe(422);
    expect((await request(a).post("/calls/test-ring").send({ endpoint: "not a url" })).status).toBe(422);
    expect((await request(a).post("/calls/test-ring").send({ endpoint: "https://push.example/abc", user_id: "x" })).status).toBe(422);
    const ok = await request(a).post("/calls/test-ring").send({ endpoint: "https://push.example/abc" });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ sent: 1, failed: 0, total: 1 });
    expect(spy.mock.calls[0][1]).toEqual({ actor: expect.objectContaining({ user_id: expect.any(String) }), endpoint: "https://push.example/abc" });
  });

  test("a test-ring flood is 429", async () => {
    jest.spyOn(calls, "testRing").mockResolvedValue({ sent: 1, failed: 0, total: 1 });
    const a = app("test-ring-flood");
    const statuses = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push((await request(a).post("/calls/test-ring").send({ endpoint: "https://push.example/abc" })).status);
    }
    expect(statuses.slice(0, 5)).toEqual(Array(5).fill(200));
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  test("accept passes the tenant, so the ring's cancel push can be queued", async () => {
    const spy = jest.spyOn(calls, "acceptCall").mockResolvedValue({ call_id: CALL });
    await request(app("accept-tenant")).post(`/calls/${CALL}/accept`);
    expect(spy.mock.calls[0][1]).toMatchObject({ id: CALL, tenantMeta: { slug: "accept-tenant" } });
  });
});
