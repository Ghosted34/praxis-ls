"use strict";
/**
 * Calls audit D2 and §4: one limiter per provider key, shared by every
 * worker; a fair share per tenant, so one tenant's backlog cannot starve
 * another's transcripts; and when Redis is down, the same limits per process
 * — fail safe, never unlimited.
 */
jest.mock("../../src/config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));
const { logger } = require("../../src/config/logger");
const { createFakeRedis } = require("../helpers/fake-redis");
const gate = require("../../src/modules/smartcomm/smartcomm.call.gate");

const T0 = Date.parse("2026-09-25T10:00:10Z");
let redis;
beforeEach(() => {
  redis = createFakeRedis({ now: () => T0 });
  gate.resetLocalForTests();
  logger.warn.mockClear();
});

describe("the per-tenant fair share", () => {
  const opts = { tenantPerMin: 12, tenantBurst: 20, now: T0 };

  test("a burst goes straight through, then parts are spaced at the tenant's rate", async () => {
    const waits = [];
    for (let i = 0; i < 25; i += 1) waits.push(await gate.reserveTenantSlot(redis, { slug: "busy", ...opts }));
    expect(waits.slice(0, 20).every((w) => w === 0)).toBe(true);
    expect(waits.slice(20)).toEqual([5000, 10000, 15000, 20000, 25000]);
  });

  test("2,000 queued parts at one tenant do not delay another tenant's first part", async () => {
    for (let i = 0; i < 2000; i += 1) await gate.reserveTenantSlot(redis, { slug: "busy", ...opts });
    expect(await gate.reserveTenantSlot(redis, { slug: "quiet", ...opts })).toBe(0);
    // …and the busy tenant's 2,001st part waits its own turn, ~166 minutes out.
    const w = await gate.reserveTenantSlot(redis, { slug: "busy", ...opts });
    expect(w).toBeGreaterThan(160 * 60_000);
  });

  test("each part gets its own slot: no two waits are the same, so nothing churns", async () => {
    for (let i = 0; i < 20; i += 1) await gate.reserveTenantSlot(redis, { slug: "t", ...opts });
    const waits = [];
    for (let i = 0; i < 50; i += 1) waits.push(await gate.reserveTenantSlot(redis, { slug: "t", ...opts }));
    expect(new Set(waits).size).toBe(50);
  });

  test("Redis down: the same share per process, never unlimited, logged at WARN", async () => {
    redis._state.fail = true;
    const waits = [];
    for (let i = 0; i < 22; i += 1) waits.push(await gate.reserveTenantSlot(redis, { slug: "busy", ...opts }));
    expect(waits.slice(0, 20).every((w) => w === 0)).toBe(true);
    expect(waits[20]).toBe(5000);
    expect(waits[21]).toBe(10000);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("the provider limiters", () => {
  const lim = { groqRpm: 3, groqAudioPerHour: 400, geminiRpm: 2, now: T0 };

  test("Groq while it has room, then Gemini, then nobody (with the wait to the next minute)", async () => {
    const lanes = [];
    for (let i = 0; i < 6; i += 1) lanes.push((await gate.route(redis, { seconds: 100, ...lim })).provider);
    expect(lanes).toEqual(["groq", "groq", "groq", "gemini", "gemini", null]);
    const none = await gate.route(redis, { seconds: 100, ...lim });
    expect(none.retryInMs).toBe(60_000 - (T0 % 60_000) + 250);
  });

  test("Groq's audio-seconds an hour is a limit too: a full hour sends parts to Gemini", async () => {
    expect((await gate.route(redis, { seconds: 120, ...lim, groqRpm: 100 })).provider).toBe("groq");
    expect((await gate.route(redis, { seconds: 120, ...lim, groqRpm: 100 })).provider).toBe("groq");
    expect((await gate.route(redis, { seconds: 120, ...lim, groqRpm: 100 })).provider).toBe("groq");
    expect((await gate.route(redis, { seconds: 120, ...lim, groqRpm: 100 })).provider).toBe("gemini");
  });

  test("a refused take does not use up the window", async () => {
    for (let i = 0; i < 3; i += 1) await gate.takeProvider(redis, "groq", { seconds: 1, ...lim });
    expect(await gate.takeProvider(redis, "groq", { seconds: 1, ...lim })).toBe(false);
    const minute = Math.floor(T0 / 60_000);
    expect(await redis.get(gate.keys.RPM_KEY("groq", minute))).toBe("3");
  });

  test("the limit is shared: two workers on one Redis take from one window", async () => {
    const w1 = gate.takeProvider;
    let taken = 0;
    for (let i = 0; i < 10; i += 1) if (await w1(redis, "gemini", lim)) taken += 1;
    expect(taken).toBe(2);
  });

  test("Redis down: per-process windows with the same limits, never unlimited", async () => {
    redis._state.fail = true;
    const lanes = [];
    for (let i = 0; i < 6; i += 1) lanes.push((await gate.route(redis, { seconds: 100, ...lim })).provider);
    expect(lanes).toEqual(["groq", "groq", "groq", "gemini", "gemini", null]);
  });
});
