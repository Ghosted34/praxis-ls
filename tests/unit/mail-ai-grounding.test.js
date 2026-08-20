"use strict";
const g = require("../../src/modules/mail/assist/assist.grounding");

describe("grounding deny-list", () => {
  test.each(["costing", "margin", "payroll", "salary", "buy_rate", "email_thread_note", "pricing_variance"])(
    "%s is out of bounds",
    (k) => { expect(g.isDenied(k)).toBe(true); },
  );
  test("whitelisted keys are not denied", () => {
    for (const k of g.allowedKeys()) expect(g.isDenied(k)).toBe(false);
  });
  test("the whitelist does not include costing or payroll", () => {
    expect(g.allowedKeys().join(" ")).not.toMatch(/costing|payroll|margin/);
  });
});
