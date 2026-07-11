"use strict";
/** COA rules (MOD-06): class-consistency + hierarchy. */
const { classOf, assertCodeClass, isChildOf } = require("../../src/modules/master/chart_of_accounts/chart_of_accounts.rules");
describe("chart of accounts rules", () => {
  it("classOf = first digit", () => { expect(classOf("4111")).toBe(4); expect(classOf("706")).toBe(7); });
  it("assertCodeClass passes when class matches", () => { expect(() => assertCodeClass("4111", 4)).not.toThrow(); });
  it("rejects class/code mismatch", () => { expect(() => assertCodeClass("4111", 5)).toThrow(/class/i); });
  it("rejects non-numeric codes", () => { expect(() => assertCodeClass("ABC", 4)).toThrow(/code/i); });
  it("isChildOf by prefix", () => { expect(isChildOf("4731", "473")).toBe(true); expect(isChildOf("706", "707")).toBe(false); });
});
