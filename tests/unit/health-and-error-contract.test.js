"use strict";

/**
 * Two controls that were reporting success while doing nothing, and the tests
 * that fail when either stops working.
 *
 * OBS-A2 / TEST-D4 — the health check could not fail. It returned {ok:true}
 * without touching a dependency, and scripts/deploy.sh used it as the gate that
 * declares a deploy successful. A container that could not reach Postgres
 * passed it every time. The audit verified this by taking the database down and
 * watching it still answer 200.
 *
 * API F-1 — `err.status` was read only inside the AppError branch, so eighteen
 * deliberate 4xx conditions reached consumers as 500 INTERNAL_ERROR and logged
 * at error level. That is being fixed BEFORE alerting is switched on, because
 * an alert channel whose first week is full of "ticket not found" gets muted.
 */

const express = require("express");
const request = require("supertest");

describe("OBS-A2 — the readiness probe can actually fail", () => {
  // Mocks services/platform/db, NOT config/database. The first version of the
  // probe used config/database.query(), whose `initDatabase()` is never called
  // anywhere in src/ — so it threw "db pool not initialised" regardless of
  // database health, returned 503 on a healthy server, and failed the deploy at
  // the readiness gate. A probe that cannot pass is as bad as one that cannot
  // fail; this suite now exercises the pool the API actually uses.
  const OK = { rows: [{ "?column?": 1 }] };

  function buildAppWith({ pgFails = false, redisFails = false } = {}) {
    jest.resetModules();
    jest.doMock("../../src/services/platform/db", () => ({
      query: jest.fn(() =>
        pgFails
          ? Promise.reject(new Error("connect ECONNREFUSED"))
          : Promise.resolve(OK),
      ),
    }));
    jest.doMock("../../src/config/redis", () => ({
      getClient: () => ({
        ping: () =>
          redisFails
            ? Promise.reject(new Error("redis down"))
            : Promise.resolve("PONG"),
      }),
    }));
    jest.doMock("../../src/shared/http/module-loader", () => ({
      mountReport: () => ({ mounted: ["a/b", "c/d"], skipped: [] }),
    }));

    const { router } = require("../../src/routes/health");
    const app = express();
    app.use("/api", router);
    return app;
  }

  afterEach(() => jest.resetModules());

  it("returns 200 and status 'ready' when every dependency is up", async () => {
    const res = await request(buildAppWith()).get("/api/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.checks.postgres.status).toBe("up");
    expect(res.body.checks.redis.status).toBe("up");
  });

  it("returns 503 when Postgres is unreachable — THE regression this exists for", async () => {
    // This is the exact scenario the old endpoint passed. If this test ever
    // goes green on a 200, the deploy gate is blind again.
    const res = await request(buildAppWith({ pgFails: true })).get(
      "/api/health/ready",
    );
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.status).toBe("unavailable");
    expect(res.body.checks.postgres.status).toBe("down");
  });

  it("reports 'degraded' but stays 200 when only Redis is down", async () => {
    // Redis loss degrades sessions and rate limiting but the API still serves,
    // so this must not 503 — a 503 here would make the deploy gate fail on a
    // cache blip and turn a degradation into an outage.
    const res = await request(buildAppWith({ redisFails: true })).get(
      "/api/health/ready",
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.redis.status).toBe("down");
  });

  it("liveness stays up even when everything else is down", async () => {
    // Deliberate: a restart policy keyed on this must not restart every
    // container during a database incident.
    const res = await request(
      buildAppWith({ pgFails: true, redisFails: true }),
    ).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("alive");
  });

  it("reports build identity (TEST-R2)", async () => {
    const res = await request(buildAppWith()).get("/api/health");
    expect(res.body.build).toBeDefined();
    expect(res.body.build).toHaveProperty("commit");
    expect(res.body.build).toHaveProperty("version");
  });

  it("surfaces modules that failed to load (API F-19)", async () => {
    jest.resetModules();
    jest.doMock("../../src/services/platform/db", () => ({
      query: jest.fn(() => Promise.resolve(OK)),
    }));
    jest.doMock("../../src/config/redis", () => ({
      getClient: () => ({ ping: () => Promise.resolve("PONG") }),
    }));
    jest.doMock("../../src/shared/http/module-loader", () => ({
      mountReport: () => ({
        mounted: ["a/b"],
        skipped: [{ module: "wms/inbound", error: "boom" }],
      }),
    }));
    const { router } = require("../../src/routes/health");
    const app = express();
    app.use("/api", router);

    const res = await request(app).get("/api/health/ready");
    expect(res.status).toBe(200); // serving, but incompletely
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.modules.skipped).toContain("wms/inbound");
  });
});

describe("API F-1 — the error handler honours err.status", () => {
  const { errorHandler } = require("../../src/middleware/error-handler");

  function appThrowing(err) {
    const app = express();
    app.use((req, _res, next) => {
      req.request_id = "test-request-id";
      next();
    });
    app.get("/boom", () => {
      throw err;
    });
    app.use(errorHandler);
    return app;
  }

  it("a plain Error with status 404 returns 404, not 500", async () => {
    // The shape used by support.service.js, godmode.service.js,
    // financial_dictionary.service.js and the platform services — seven files,
    // eighteen throw sites, every one of which used to surface as a 500.
    const err = new Error("Ticket not found");
    err.status = 404;
    err.code = "NOT_FOUND";

    const res = await request(appThrowing(err)).get("/boom");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe("Ticket not found");
    expect(res.body.request_id).toBe("test-request-id");
  });

  it("a 422 keeps its status and message", async () => {
    const err = new Error("Cannot record CSAT on an unresolved ticket");
    err.status = 422;
    const res = await request(appThrowing(err)).get("/boom");
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/unresolved ticket/);
  });

  it("a thrown 5xx is still flattened to a generic 500", async () => {
    // Conservative on purpose: an arbitrary throw does not get to pick a
    // server-error code or leak its message to a client.
    const err = new Error(
      "upstream exploded with connection string user:pw@host",
    );
    err.status = 503;
    const res = await request(appThrowing(err)).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(res.body.error.message).not.toMatch(/connection string/);
  });

  it("an ordinary Error with no status is still a 500", async () => {
    const res = await request(
      appThrowing(new Error("genuinely unexpected")),
    ).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(res.body.error.message).not.toMatch(/genuinely unexpected/);
  });

  it("expose:false hides the message but keeps the status", async () => {
    const err = new Error("internal detail");
    err.status = 403;
    err.expose = false;
    const res = await request(appThrowing(err)).get("/boom");
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("Request rejected");
  });
});
