"use strict";
/**
 * Punch list window (PR1) — timezone-safe, never `clock_in_at::date`.
 */

const repo = require("../../src/modules/hr/attendance/attendance.repo");

function capture() {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  return { client, calls };
}

describe("attendance.repo.list date window", () => {
  it("does not filter on clock_in_at::date", async () => {
    const { client, calls } = capture();
    await repo.list(client, { date: "2026-08-18", timeZone: "Africa/Douala" });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).not.toMatch(/clock_in_at::date/);
    expect(calls[0].sql).toMatch(/AT TIME ZONE/);
    expect(calls[0].params).toEqual(expect.arrayContaining(["2026-08-18", "Africa/Douala"]));
  });

  it("applies a from/to range in the workplace zone", async () => {
    const { client, calls } = capture();
    await repo.list(client, { from: "2026-08-01", to: "2026-08-07", timeZone: "Africa/Ndjamena" });
    const { sql, params } = calls[0];
    expect(sql).toMatch(/AT TIME ZONE/);
    expect(params).toEqual(expect.arrayContaining(["2026-08-01", "2026-08-07", "Africa/Ndjamena"]));
    expect(sql).not.toMatch(/clock_in_at::date/);
  });

  it("defaults the zone to Douala when none is passed", async () => {
    const { client, calls } = capture();
    await repo.list(client, { date: "2026-08-18" });
    expect(calls[0].params).toContain("Africa/Douala");
  });
});
