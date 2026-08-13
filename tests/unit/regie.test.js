"use strict";
/** Régie aging decision (KB §6.8) — pure, no DB. */
const {
  openBalance,
  isAged,
  daysBetween,
} = require("../../src/modules/costing/regie/regie.rules");

const adv = (o = {}) => ({
  amount: 500000,
  justified_amount: 0,
  returned_amount: 0,
  issued_on: "2026-01-01",
  policy_window_days: 7,
  state: "ISSUED",
  ...o,
});

describe("openBalance", () => {
  it("= amount - justified - returned", () => {
    expect(
      openBalance(adv({ justified_amount: 100000, returned_amount: 50000 })),
    ).toBe(350000);
  });
});

describe("isAged", () => {
  it("true when past window, still open, and in an ageable state", () => {
    expect(isAged(adv(), "2026-01-15")).toBe(true);
  });
  it("false inside the window", () => {
    expect(isAged(adv(), "2026-01-05")).toBe(false);
  });
  it("false when fully justified/returned (no open balance)", () => {
    expect(isAged(adv({ justified_amount: 500000 }), "2026-02-01")).toBe(false);
  });
  it("false when already aged or closed", () => {
    expect(isAged(adv({ state: "AGED_UNJUSTIFIED" }), "2026-02-01")).toBe(
      false,
    );
    expect(isAged(adv({ state: "JUSTIFIED" }), "2026-02-01")).toBe(false);
  });
  it("boundary: exactly window days is not yet aged", () => {
    expect(daysBetween("2026-01-01", "2026-01-08")).toBe(7);
    expect(isAged(adv(), "2026-01-08")).toBe(false); // 7 days == window, not > window
    expect(isAged(adv(), "2026-01-09")).toBe(true);
  });
});
