"use strict";
/** Milestone engine (MOD-31): due-date from offsets + stage transitions. */
const { computeDue, canAdvance } = require("../../src/modules/operations/milestone/milestone.rules");

describe("computeDue", () => {
  it("adds offset days", () => {
    expect(computeDue("2026-02-01", 5)).toBe("2026-02-06");
    expect(computeDue("2026-02-01", 0)).toBe("2026-02-01");
  });
  it("crosses month/year boundaries", () => {
    expect(computeDue("2026-02-26", 5)).toBe("2026-03-03");
    expect(computeDue("2026-12-30", 3)).toBe("2027-01-02");
  });
});

describe("canAdvance", () => {
  it("PENDING → IN_PROGRESS → DONE", () => {
    expect(canAdvance("PENDING", "IN_PROGRESS")).toBe(true);
    expect(canAdvance("IN_PROGRESS", "DONE")).toBe(true);
  });
  it("block + unblock", () => {
    expect(canAdvance("IN_PROGRESS", "BLOCKED")).toBe(true);
    expect(canAdvance("BLOCKED", "IN_PROGRESS")).toBe(true);
  });
  it("rejects illegal / from-DONE", () => {
    expect(canAdvance("PENDING", "DONE")).toBe(false);
    expect(canAdvance("DONE", "IN_PROGRESS")).toBe(false);
  });
});
