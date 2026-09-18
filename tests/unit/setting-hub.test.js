"use strict";
const {
  assertValue,
  KNOWN_SECTIONS,
} = require("../../src/modules/security/setting/setting.rules");

describe("Settings hub validation (MOD-70)", () => {
  test("accepts object values", () => {
    expect(assertValue("finance", "regie", { policy_window_days: 7 })).toBe(
      true,
    );
    expect(assertValue("email", "default", { from: "x@y.cm" })).toBe(true);
  });
  test("accepts list values only for policy/tier settings", () => {
    expect(
      assertValue("finance", "receivables_dunning", [
        { min_days: 7, level: 1 },
      ]),
    ).toBe(true);
    expect(() => assertValue("appearance", "logo", ["a", "b"])).toThrow();
  });
  test("rejects non-object scalar values", () => {
    expect(() => assertValue("appearance", "theme", "dark")).toThrow();
    expect(() => assertValue("appearance", "theme", 42)).toThrow();
  });

  /* hr.timezone — one field where a bad value took two whole screens down in
   * production. The setting is jsonb but the store shape is deliberately guarded
   * here, at the field, BEFORE the generic object check, because a value written
   * as free text (the original production value was "WAT") surfaces as a
   * RangeError in every other module that reads it. `timezoneOf` degrades an
   * unreadable value on read; this is the half that stops the write. */
  test("hr.timezone must be an IANA timezone name", () => {
    expect(assertValue("hr", "timezone", "Africa/Douala")).toBe(true);
    expect(assertValue("hr", "timezone", "Europe/Paris")).toBe(true);
    expect(assertValue("hr", "timezone", "UTC")).toBe(true);
    expect(() => assertValue("hr", "timezone", "WAT")).toThrow();
    expect(() => assertValue("hr", "timezone", "GMT+1")).toThrow();
    expect(() => assertValue("hr", "timezone", "UTC+01:00")).toThrow();
    expect(() => assertValue("hr", "timezone", "Central Africa Time")).toThrow();
    expect(() => assertValue("hr", "timezone", "Africa/ Douala")).toThrow();
    expect(() => assertValue("hr", "timezone", "")).toThrow();
    expect(() => assertValue("hr", "timezone", null)).toThrow();
  });

  test("hr keys other than timezone are unaffected by the field guard", () => {
    expect(assertValue("hr", "attendance_policy", { work_start: "08:00" })).toBe(true);
    // A plain object is the ordinary shape; only the timezone key is special.
    expect(assertValue("hr", "weekend_days", { days: [0, 6] })).toBe(true);
  });
  test("validates numbering scheme shape", () => {
    expect(
      assertValue("numbering", "MOD-51", {
        prefix: "INV",
        padding: 5,
        reset: "yearly",
      }),
    ).toBe(true);
    expect(() => assertValue("numbering", "MOD-51", { padding: 99 })).toThrow();
    expect(() =>
      assertValue("numbering", "MOD-51", { reset: "daily" }),
    ).toThrow();
  });
  test("known sections advertised", () => {
    expect(KNOWN_SECTIONS).toEqual(
      expect.arrayContaining(["numbering", "finance", "email", "workflow"]),
    );
  });
});
