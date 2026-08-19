"use strict";
/**
 * Clock-in return contract (PR1).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `location_status` on the punch response was written as
 * `locationStatus({ ...row, location_source })` — shorthand for an identifier
 * that no scope in the function declared. Under "use strict" that is a
 * ReferenceError on EVERY clock-in, not an edge case, and the suite did not
 * notice: nothing in `tests/` had ever called `clockIn`. The endpoint people
 * are paid through was reachable only through the linter.
 *
 * That is the same failure the comment above `repo.create` in the service
 * already describes ("threw on EVERY clock-in — the endpoint had never once
 * worked"), reintroduced on the same line of the same function. A comment
 * recording a bug does not prevent it; a test that calls the function does.
 *
 * So this asserts the whole contract of the returned punch, not merely that the
 * call does not throw.
 */

const repo = require("../../src/modules/hr/attendance/attendance.repo");
const { getSetting } = require("../../src/shared/config/settings");

jest.mock("../../src/modules/hr/attendance/attendance.repo", () => ({
  // makeService reads cfg at construction to build __entityMeta.
  cfg: { table: "attendance_log", pk: "attendance_id", activeColumn: null },
  employeeIdForUser: jest.fn(),
  openForEmployee: jest.fn(async () => null),
  entityForEmployee: jest.fn(async () => "entity-1"),
  activeSitesForEntity: jest.fn(async () => []),
  upsertDevice: jest.fn(),
  create: jest.fn(),
}));
jest.mock("../../src/modules/master/employees/employees.service", () => ({
  assertActive: jest.fn(async () => true),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => null),
  audit: jest.fn(async () => null),
  resolveActorId: jest.fn(async () => null),
}));
jest.mock("../../src/shared/config/settings", () => ({ getSetting: jest.fn() }));
jest.mock("../../src/services/geoapify.service", () => ({
  reverseGeocode: jest.fn(async () => "Bonabéri, Douala"),
}));
jest.mock("../../src/modules/hr/attendance/attendance.query", () => ({
  upsertAutoQuery: jest.fn(async () => null),
}));

const service = require("../../src/modules/hr/attendance/attendance.service");

/** Settings this path reads. Defaults chosen so nothing blocks the punch. */
function settings(overrides = {}) {
  const table = {
    geofence: "off",
    device_policy: "off",
    attendance_policy: null,
    timezone: "Africa/Douala",
    ...overrides,
  };
  getSetting.mockImplementation(async (_client, _scope, key, fallback) =>
    key in table ? table[key] : fallback,
  );
}

/** No lateness rule — keeps the auto-query branch out of this test's way. */
const client = { query: async () => ({ rows: [] }) };

beforeEach(() => {
  jest.clearAllMocks();
  settings();
});

describe("clockIn", () => {
  it("returns the punch with a location_status (regression: undeclared location_source)", async () => {
    repo.create.mockResolvedValue({
      attendance_id: "att-1",
      clock_in_at: new Date("2026-08-19T07:30:00Z"),
      latitude: 4.05,
      longitude: 9.76,
      within_geofence: true,
      location_source: "gps",
    });

    const out = await service.clockIn(client, {
      employeeId: "emp-1",
      latitude: 4.05,
      longitude: 9.76,
      accuracy: 12,
    });

    expect(out.attendance_id).toBe("att-1");
    expect(out.location_status).toBe("on_site");
    expect(out.device_new).toBe(false);
  });

  it("stores gps as the source and keeps the location payload when a fix arrives", async () => {
    repo.create.mockResolvedValue({
      attendance_id: "att-2",
      clock_in_at: new Date(),
      latitude: 4.05,
      longitude: 9.76,
      within_geofence: null,
      location_source: "gps",
    });

    const out = await service.clockIn(client, { employeeId: "emp-1", latitude: 4.05, longitude: 9.76, accuracy: 8 });

    const written = repo.create.mock.calls[0][1];
    expect(written.location_source).toBe("gps");
    expect(written.location).toEqual({ lat: 4.05, lng: 9.76, accuracy: 8 });
    // Coordinates against no worksite is NOT a missing fix.
    expect(out.location_status).toBe("unfenced");
  });

  it("stores none — and no location payload — when the punch had no fix", async () => {
    repo.create.mockResolvedValue({
      attendance_id: "att-3",
      clock_in_at: new Date(),
      latitude: null,
      longitude: null,
      within_geofence: null,
      location_source: "none",
    });

    const out = await service.clockIn(client, { employeeId: "emp-1" });

    const written = repo.create.mock.calls[0][1];
    expect(written.location_source).toBe("none");
    expect(written.location).toBeNull();
    expect(out.location_status).toBe("no_gps");
  });

  it("refuses a second open shift rather than opening one", async () => {
    repo.openForEmployee.mockResolvedValueOnce({ attendance_id: "att-open" });
    await expect(service.clockIn(client, { employeeId: "emp-1" })).rejects.toMatchObject({
      code: "ALREADY_CLOCKED_IN",
      status: 409,
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("blocks an off-site punch only under the block policy", async () => {
    settings({ geofence: "block" });
    repo.activeSitesForEntity.mockResolvedValueOnce([
      { work_site_id: "site-1", latitude: 4.05, longitude: 9.76, radius_m: 100 },
    ]);
    // ~1.6 km north of the site — outside a 100 m fence.
    await expect(
      service.clockIn(client, { employeeId: "emp-1", latitude: 4.065, longitude: 9.76 }),
    ).rejects.toMatchObject({ code: "OUT_OF_GEOFENCE", status: 422 });
    expect(repo.create).not.toHaveBeenCalled();
  });
});
