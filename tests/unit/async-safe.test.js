"use strict";

/**
 * Regression guard for doc/PHASE0_PRODUCTION_AUDIT.md §1.
 *
 * Before the async-safe shim, an `async` middleware that threw (exactly what
 * authMiddleware/requirePermission do on an unauthenticated or unauthorised
 * request) produced an unhandled rejection that crashed the process instead of
 * reaching the error handler. This test mounts a throwing async middleware —
 * both the synchronous-throw and post-`await`-throw shapes — and asserts the
 * request gets a clean JSON error, not a hang/crash.
 */

require("../../src/shared/http/async-safe");
const express = require("express");
const request = require("supertest");
const { AppError } = require("../../src/utils/errors");
const {
  errorHandler,
  notFoundHandler,
} = require("../../src/middleware/error-handler");

function buildApp() {
  const app = express();
  const r = express.Router();
  // Mirrors authMiddleware: throws synchronously before any await.
  r.get("/sync-throw", async () => {
    throw new AppError("AUTH_REQUIRED", "Authorization header missing", 401);
  });
  // Mirrors requirePermission: throws after an await.
  r.get("/async-throw", async () => {
    await Promise.resolve();
    throw new AppError("PERMISSION_DENIED", "No permission", 403);
  });
  app.use("/api", r);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("async-safe middleware", () => {
  const app = buildApp();

  it("routes a synchronous throw to the error handler as 401 (not a crash)", async () => {
    const res = await request(app).get("/api/sync-throw");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("routes a post-await throw to the error handler as 403 (not a crash)", async () => {
    const res = await request(app).get("/api/async-throw");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("returns a structured 404 for unknown routes", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
