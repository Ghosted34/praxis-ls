import { describe, expect, it } from "vitest";
import { money, money0, moneyCompact } from "./format";

/**
 * `moneyCompact` exists because "72,000,000.00 XAF" does not fit in a KPI tile.
 *
 * The strip gives each tile one line shared between a value, a label and a
 * hint. The full formatter overflowed it — the value wrapped to a second line
 * and the hint was laid out past the card's right edge and clipped, at every
 * width down to 1440px. The other half of that fix is in `kpi-tile.tsx`; this
 * half is making the string short enough that truncation never has to happen.
 *
 * The case that matters most is the LAST one: zero is a real figure and must
 * not come back as "—", because on the 360s "—" already means "you are not
 * allowed to see this". `money0` conflates the two, which is exactly why it
 * could not be reused here.
 */
describe("moneyCompact", () => {
  it("scales into K, M and B", () => {
    expect(moneyCompact(72_000_000)).toBe("72M XAF");
    expect(moneyCompact(1_500_000_000)).toBe("1.5B XAF");
    expect(moneyCompact(250_000)).toBe("250K XAF");
  });

  it("keeps one decimal only when it says something", () => {
    expect(moneyCompact(43_200_000)).toBe("43.2M XAF");
    expect(moneyCompact(43_000_000)).toBe("43M XAF");
    // Rounds rather than truncating — 43.25M is nearer 43.3 than 43.2.
    expect(moneyCompact(43_250_000)).toBe("43.3M XAF");
  });

  it("leaves small figures alone — they are already short", () => {
    expect(moneyCompact(9_999)).toBe("9,999 XAF");
    expect(moneyCompact(1_200)).toBe("1,200 XAF");
  });

  it("honours the currency, and defaults to XAF", () => {
    expect(moneyCompact(2_000_000, "EUR")).toBe("2M EUR");
    expect(moneyCompact(2_000_000, "")).toBe("2M XAF");
    expect(moneyCompact(2_000_000, null)).toBe("2M XAF");
  });

  it("handles negatives, which a corrected forecast can be", () => {
    expect(moneyCompact(-2_400_000)).toBe("-2.4M XAF");
  });

  it("shows zero as zero — the difference `money0` throws away", () => {
    // A pipeline worth nothing is a fact. On the 360s "—" is reserved for a
    // figure the caller lacks finance visibility for, so zero must not collide
    // with it.
    expect(moneyCompact(0)).toBe("0 XAF");
    expect(money0(0)).toBe("—");
  });

  it("is only ever '—' for a genuinely absent value", () => {
    expect(moneyCompact(null)).toBe("—");
    expect(moneyCompact(undefined)).toBe("—");
    expect(moneyCompact("")).toBe("—");
    expect(moneyCompact("not a number")).toBe("—");
  });

  it("accepts the strings pg hands back for numerics", () => {
    expect(moneyCompact("72000000")).toBe("72M XAF");
  });

  it("is short enough for a tile — the whole point", () => {
    // The full formatter is what broke the strip; the compact one has to be
    // comfortably shorter than it for every figure this app shows.
    for (const n of [72_000_000, 43_200_000, 1_500_000_000, 250_000]) {
      expect(moneyCompact(n).length).toBeLessThan(money(n).length);
      expect(moneyCompact(n).length).toBeLessThanOrEqual(10);
    }
  });
});
