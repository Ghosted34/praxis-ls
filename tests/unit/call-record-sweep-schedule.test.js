"use strict";
/**
 * Audit A1: the daily call-record sweep ran at 00:00 UTC (01:00 in Douala)
 * because BullMQ aligns `repeat.every` to the epoch. It is now a cron in the
 * corridor's timezone during working hours, and the old repeatable is removed
 * at boot: BullMQ keeps a repeatable under its old key until someone removes
 * it, so without that the midnight run would keep firing next to the new one.
 */
const { getNextMillis } = require("bullmq/dist/cjs/classes/repeat");
const { config } = require("../../src/config/env");
const schedule = require("../../src/jobs/call-record-sweep-schedule");

function fakeQueue(repeatables) {
  const removed = [];
  return {
    removed,
    getRepeatableJobs: jest.fn(async () => repeatables),
    removeRepeatableByKey: jest.fn(async (key) => {
      removed.push(key);
      return true;
    }),
  };
}

describe("the schedule", () => {
  test("defaults to 10:00 Africa/Douala", () => {
    expect(config.COMMS_CALL_RECORD_SWEEP_CRON).toBe("0 10 * * *");
    expect(config.COMMS_CALL_RECORD_SWEEP_TZ).toBe("Africa/Douala");
  });

  test("BullMQ computes the default as 09:00 UTC, never midnight UTC", () => {
    const from = Date.parse("2026-09-24T23:30:00Z");
    const next = new Date(getNextMillis(from, { pattern: "0 10 * * *", tz: "Africa/Douala" }));
    expect(next.toISOString()).toBe("2026-09-25T09:00:00.000Z");
    // What the old `every: 86_400_000` produced from the same instant.
    const old = new Date(getNextMillis(from, { every: 86_400_000 }));
    expect(old.toISOString()).toBe("2026-09-25T00:00:00.000Z");
  });
});

describe("registration removes the old repeatable first", () => {
  test("the old every-24h entry is removed", async () => {
    const queue = fakeQueue([
      { key: "comms-call-record-sweep-scheduler::::86400000", name: "tick", every: "86400000", pattern: null, tz: null },
    ]);
    const removed = await schedule.removeStaleRepeatables(queue, { pattern: "0 10 * * *", tz: "Africa/Douala" });
    expect(queue.removed).toEqual(["comms-call-record-sweep-scheduler::::86400000"]);
    expect(removed).toBe(1);
  });

  test("a changed cron replaces the previous one; the current one is kept", async () => {
    const queue = fakeQueue([
      { key: "k-old-cron", name: "tick", every: null, pattern: "0 8 * * *", tz: "Africa/Douala" },
      { key: "k-current", name: "tick", every: null, pattern: "0 10 * * *", tz: "Africa/Douala" },
      { key: "k-other-tz", name: "tick", every: null, pattern: "0 10 * * *", tz: "UTC" },
    ]);
    await schedule.removeStaleRepeatables(queue, { pattern: "0 10 * * *", tz: "Africa/Douala" });
    expect(queue.removed.sort()).toEqual(["k-old-cron", "k-other-tz"]);
  });

  test("the worker prunes, then registers the cron, and never the every-24h repeat", () => {
    const src = require("fs").readFileSync(require.resolve("../../src/jobs/workers.js"), "utf8");
    const recurring = src.slice(src.indexOf("async function scheduleRecurring"));
    const prune = recurring.indexOf("removeStaleRepeatables(");
    const register = recurring.indexOf('enqueue("comms-call-record-sweep-scheduler"');
    expect(prune).toBeGreaterThan(-1);
    expect(register).toBeGreaterThan(prune);
    expect(recurring).toMatch(/COMMS_CALL_RECORD_SWEEP_CRON/);
    expect(recurring).toMatch(/repeat:\s*recordSweep/);
    expect(src).not.toMatch(/comms-call-record-sweep-scheduler"[\s\S]{0,120}every:\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });
});
