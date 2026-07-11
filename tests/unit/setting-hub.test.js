"use strict";
const { assertValue, KNOWN_SECTIONS } = require("../../src/modules/security/setting/setting.rules");

describe("Settings hub validation (MOD-70)", () => {
  test("accepts object values", () => {
    expect(assertValue("finance", "regie", { policy_window_days: 7 })).toBe(true);
    expect(assertValue("email", "default", { from: "x@y.cm" })).toBe(true);
  });
  test("accepts list values only for policy/tier settings", () => {
    expect(assertValue("finance", "receivables_dunning", [{ min_days: 7, level: 1 }])).toBe(true);
    expect(() => assertValue("appearance", "logo", ["a", "b"])).toThrow();
  });
  test("rejects non-object scalar values", () => {
    expect(() => assertValue("appearance", "theme", "dark")).toThrow();
    expect(() => assertValue("appearance", "theme", 42)).toThrow();
  });
  test("validates numbering scheme shape", () => {
    expect(assertValue("numbering", "MOD-51", { prefix: "INV", padding: 5, reset: "yearly" })).toBe(true);
    expect(() => assertValue("numbering", "MOD-51", { padding: 99 })).toThrow();
    expect(() => assertValue("numbering", "MOD-51", { reset: "daily" })).toThrow();
  });
  test("known sections advertised", () => {
    expect(KNOWN_SECTIONS).toEqual(expect.arrayContaining(["numbering", "finance", "email", "workflow"]));
  });
});
