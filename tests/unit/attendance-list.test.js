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

/* ── PR2 filters on the log ────────────────────────────────────────────── */

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";

describe("attendance.repo.list employee/department filters", () => {
  it("takes a set of employees as ONE bound array, not an interpolated IN list", async () => {
    const { client, calls } = capture();
    await repo.list(client, { employee_ids: [U1, U2] });
    expect(calls[0].sql).toMatch(/= ANY\(\$\d+::uuid\[\]\)/);
    expect(calls[0].params).toContainEqual([U1, U2]);
  });

  it("accepts a comma-separated list, which is how a URL carries one", async () => {
    const { client, calls } = capture();
    await repo.list(client, { employee_ids: `${U1},${U2}` });
    expect(calls[0].params).toContainEqual([U1, U2]);
  });

  it("DROPS a non-uuid rather than handing junk to a uuid[] bind", async () => {
    // `GET /attendance` has no query schema (it predates one), so this is the
    // only place that can refuse it. Reaching the driver would be a 500.
    const { client, calls } = capture();
    await repo.list(client, { employee_ids: "everyone" });
    expect(calls[0].sql).not.toContain("ANY(");
  });

  it("caps the set at 50", async () => {
    const { client, calls } = capture();
    await repo.list(client, { employee_ids: Array.from({ length: 80 }, () => U1) });
    expect(calls[0].params.find((p) => Array.isArray(p))).toHaveLength(50);
  });

  it("matches a department case- and whitespace-insensitively", async () => {
    const { client, calls } = capture();
    await repo.list(client, { department: " operations " });
    expect(calls[0].sql).toContain("lower(btrim(e.department)) = lower(btrim($");
    expect(calls[0].params).toContain(" operations ");
  });
});
