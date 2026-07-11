"use strict";
const { isGrantUsable } = require("../../src/modules/portal/portal.rules");

describe("Portal access grant usability", () => {
  const now = Date.parse("2026-07-11");
  test("active + no expiry → usable", () => {
    expect(isGrantUsable({ is_active: true, expires_at: null }, now)).toBe(true);
  });
  test("active + future expiry → usable; past expiry → not", () => {
    expect(isGrantUsable({ is_active: true, expires_at: "2026-12-31" }, now)).toBe(true);
    expect(isGrantUsable({ is_active: true, expires_at: "2026-01-01" }, now)).toBe(false);
  });
  test("inactive or missing → not usable", () => {
    expect(isGrantUsable({ is_active: false, expires_at: null }, now)).toBe(false);
    expect(isGrantUsable(null, now)).toBe(false);
  });
});
