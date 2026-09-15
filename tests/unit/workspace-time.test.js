/**
 * workspace.time — turning a wall-clock string into an instant.
 *
 * These are the cases that a "looks right" read-through does not catch. Every
 * expectation below was computed from the IANA offset for that zone on that
 * date, not from the code's output — the first version of this module returned
 * its input unchanged for every zone and would have passed a test that only
 * covered UTC+0.
 */
"use strict";

const { toInstant, zonedWallClockToUtc } = require("../../src/modules/dashboard/workspace/workspace.time");

describe("toInstant — a datetime with an offset is already an instant", () => {
  it("passes a Zulu instant through untouched", () => {
    expect(toInstant("2026-09-15T17:00:00Z", { timeZone: "Africa/Douala" }))
      .toBe("2026-09-15T17:00:00.000Z");
  });

  it("converts an explicit offset rather than reinterpreting it", () => {
    // +01:00 at 17:00 IS 16:00Z. Reinterpreting on the tenant clock would give
    // 16:00Z by coincidence here and an hour out anywhere else.
    expect(toInstant("2026-09-15T17:00:00+01:00", { timeZone: "Africa/Douala" }))
      .toBe("2026-09-15T16:00:00.000Z");
    expect(toInstant("2026-09-15T17:00:00+05:30", { timeZone: "Africa/Douala" }))
      .toBe("2026-09-15T11:30:00.000Z");
  });
});

describe("toInstant — a zoneless string is read on the tenant's clock", () => {
  it("treats 17:00 in Douala (UTC+1, no DST) as 16:00Z", () => {
    expect(toInstant("2026-09-15T17:00", { timeZone: "Africa/Douala" }))
      .toBe("2026-09-15T16:00:00.000Z");
  });

  it("moves with the zone, not with the server", () => {
    // Same wall clock, three cities, three different instants.
    expect(toInstant("2026-09-15T12:00", { timeZone: "Europe/London" }))
      .toBe("2026-09-15T11:00:00.000Z"); // BST
    expect(toInstant("2026-09-15T12:00", { timeZone: "UTC" }))
      .toBe("2026-09-15T12:00:00.000Z");
    expect(toInstant("2026-09-15T12:00", { timeZone: "Asia/Kolkata" }))
      .toBe("2026-09-15T06:30:00.000Z"); // +05:30 — a half-hour zone
  });

  it("uses the offset in force ON THAT DATE, not the zone's usual one", () => {
    // London is +1 in July and +0 in January. A single hardcoded offset gets
    // one of these two wrong.
    expect(toInstant("2026-07-15T12:00", { timeZone: "Europe/London" }))
      .toBe("2026-07-15T11:00:00.000Z");
    expect(toInstant("2026-01-15T12:00", { timeZone: "Europe/London" }))
      .toBe("2026-01-15T12:00:00.000Z");
  });

  it("accepts a space separator, which is what a paste produces", () => {
    expect(toInstant("2026-09-15 17:00", { timeZone: "Africa/Douala" }))
      .toBe("2026-09-15T16:00:00.000Z");
  });
});

describe("toInstant — a bare date means different things per field", () => {
  it("reads a TASK due date as end of the working day", () => {
    expect(toInstant("2026-09-15", { timeZone: "Africa/Douala", dateOnlyTime: "17:00:00" }))
      .toBe("2026-09-15T16:00:00.000Z");
  });

  it("reads an EVENT date as the start of the day", () => {
    expect(toInstant("2026-09-15", { timeZone: "Africa/Douala", dateOnlyTime: "00:00:00" }))
      .toBe("2026-09-14T23:00:00.000Z");
  });

  it("defaults a bare date to midnight", () => {
    expect(toInstant("2026-09-15", { timeZone: "UTC" })).toBe("2026-09-15T00:00:00.000Z");
  });
});

describe("toInstant — the absences that must stay expressible", () => {
  it.each([null, undefined, "", "   "])("returns null for %p", (v) => {
    expect(toInstant(v, { timeZone: "UTC" })).toBeNull();
  });

  it("returns null for a value nothing can read, rather than an Invalid Date", () => {
    // A 500 on a list because one row held junk is worse than an empty field.
    expect(toInstant("not a date", { timeZone: "UTC" })).toBeNull();
  });
});

describe("zonedWallClockToUtc — across a DST transition", () => {
  it("resolves the New York fold without picking the wrong side", () => {
    // 2026-11-01 01:30 in New York happens twice. Either reading is defensible;
    // returning something an hour out on an ordinary day is not, and that is
    // what a non-iterative solver does.
    const out = zonedWallClockToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/New_York");
    expect(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]).toContain(out);
  });

  it("handles a date that rolls over a month boundary", () => {
    // 00:30 in Douala on the 1st is still the previous month in UTC.
    expect(zonedWallClockToUtc({ year: 2026, month: 10, day: 1, hour: 0, minute: 30 }, "Africa/Douala"))
      .toBe("2026-09-30T23:30:00.000Z");
  });

  it("handles midnight, which en-GB renders as hour 24", () => {
    expect(zonedWallClockToUtc({ year: 2026, month: 9, day: 15, hour: 0, minute: 0 }, "UTC"))
      .toBe("2026-09-15T00:00:00.000Z");
  });
});
