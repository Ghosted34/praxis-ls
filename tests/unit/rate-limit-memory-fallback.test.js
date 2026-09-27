"use strict";

/**
 * Redis down at boot must not mean "no limits" (PR-3 new finding, fixed in
 * calls audit PR-5). `initRateLimitStore()` used to set `storeKind = "memory"`
 * and leave the store null, so every limiter answered `totalHits: 1` and
 * nothing — login included — was ever limited.
 */

jest.mock("../../src/config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../src/config/redis", () => ({
  getClient: () => {
    throw new Error("Redis not initialised");
  },
}));

const express = require("express");
const request = require("supertest");
const { logger } = require("../../src/config/logger");
const rl = require("../../src/shared/http/rate-limit");

function appWith(limiter) {
  const app = express();
  app.get("/x", limiter, (_req, res) => res.json({ ok: true }));
  return app;
}

describe("rate-limit store when Redis cannot be built", () => {
  beforeAll(() => rl.initRateLimitStore());

  it("reports the in-process store and logs it at WARN", () => {
    expect(rl.initRateLimitStore()).toBe("memory");
    expect(rl.rateLimitStoreKind()).toBe("memory");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("still limits: the third request over a max of 2 is refused", async () => {
    const app = appWith(rl.makeLimiter({ name: "t-fallback", max: 2, windowMs: 60_000 }));
    expect((await request(app).get("/x")).status).toBe(200);
    expect((await request(app).get("/x")).status).toBe(200);
    const third = await request(app).get("/x");
    expect(third.status).toBe(429);
    expect(third.body).toEqual(rl.TOO_MANY);
  });

  it("keeps each limiter's counts apart (one limiter cannot spend another's budget)", async () => {
    const a = appWith(rl.makeLimiter({ name: "t-a", max: 1, windowMs: 60_000 }));
    const b = appWith(rl.makeLimiter({ name: "t-b", max: 1, windowMs: 60_000 }));
    expect((await request(a).get("/x")).status).toBe(200);
    expect((await request(b).get("/x")).status).toBe(200);
    expect((await request(a).get("/x")).status).toBe(429);
  });

  it("limits login out of the box — eleven FAILED attempts", async () => {
    const app = express();
    app.get("/x", rl.loginLimiter, (_req, res) => res.status(401).json({ error: { code: "INVALID_CREDENTIALS" } }));
    let last;
    for (let i = 0; i < 11; i += 1) last = await request(app).get("/x");
    expect(last.status).toBe(429);
  });

  /**
   * An office is one IP. Counting successful sign-ins meant the eleventh person
   * in the building to sign in within a quarter-hour was refused, having made
   * one attempt — and with the two-hour lock everyone who arrived at 08:00
   * unlocks at 10:00. A guess is an attempt that FAILED; only those count.
   */
  it("does not count successful sign-ins against the office's budget", async () => {
    const limiter = rl.makeLimiter({ name: "t-success", max: 2, windowMs: 60_000, failuresOnly: true });
    const app = appWith(limiter);
    for (let i = 0; i < 6; i += 1) {
      expect((await request(app).get("/x")).status).toBe(200);
    }
  });

  it("every credential limiter counts failures only; passkey options are counted in full", () => {
    for (const l of [rl.loginLimiter, rl.totpLimiter, rl.pinLimiter, rl.refreshLimiter, rl.webauthnLimiter]) {
      expect(l.praxisRateLimitFailuresOnly).toBe(true);
    }
    expect(rl.webauthnOptionsLimiter.praxisRateLimitFailuresOnly).toBe(false);
  });
});
