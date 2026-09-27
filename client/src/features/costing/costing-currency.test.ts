/**
 * Meeting 5 — ONE currency and ONE exchange rate per costing.
 *
 * Changing the sheet's currency or rate converts every line at once, from each
 * line's XAF value, so a round trip lands back where it started instead of
 * compounding rounding; a price converted from a rate card says what it was.
 */
import { describe, it, expect } from "vitest";
import { convertLines, priceNote, BLANK_LINE, type LineDraft } from "./costing-model";

const line = (patch: Partial<LineDraft>): LineDraft => ({ ...BLANK_LINE, label: "x", ...patch });

describe("convertLines — every line at once, at the sheet's one rate", () => {
  it("XAF → EUR divides every line by the rate", () => {
    const out = convertLines([line({ unit_cost: 72700 }), line({ unit_cost: 655957 })], 1, 655.957);
    expect(out.map((l) => l.unit_cost)).toEqual([110.83, 1000]);
  });

  it("XAF → EUR → XAF lands back on the original figure, not a rounded one", () => {
    const start = [line({ unit_cost: 72700 })];
    const eur = convertLines(start, 1, 655.957);
    expect(eur[0].unit_cost).toBe(110.83);
    const back = convertLines(eur, 655.957, 1);
    expect(back[0].unit_cost).toBe(72700); // 110.83 × 655.957 would be 72 699.72
  });

  it("changing only the rate re-prices from the same XAF value", () => {
    const eur = convertLines([line({ unit_cost: 72700 })], 1, 655.957);
    const moved = convertLines(eur, 655.957, 650);
    expect(moved[0].unit_cost).toBe(111.85);
  });

  it("a price typed after a conversion is the new starting point", () => {
    const eur = convertLines([line({ unit_cost: 72700 })], 1, 655.957);
    const typed = [{ ...eur[0], unit_cost: 120, base_unit_cost: null }];
    expect(convertLines(typed, 655.957, 1)[0].unit_cost).toBe(78714.84);
  });

  it("an unpriced line stays unpriced", () => {
    expect(convertLines([line({ unit_cost: null })], 1, 655.957)[0].unit_cost).toBeNull();
  });

  it("a débours VAT in RATE mode follows its net; a typed AMOUNT converts", () => {
    const [rate, amt] = convertLines(
      [
        line({ unit_cost: 100000, qty: 1, is_disbursement: true, vat_mode: "RATE", upstream_vat_rate_percent: 19.25, upstream_vat_amount: 19250 }),
        line({ unit_cost: 100000, qty: 1, is_disbursement: true, vat_mode: "AMOUNT", upstream_vat_rate_percent: null, upstream_vat_amount: 6559.57 }),
      ],
      1,
      655.957,
    );
    expect(rate.upstream_vat_amount).toBeCloseTo(152.45 * 0.1925, 2);
    expect(amt.upstream_vat_amount).toBe(10);
  });

  it("no change in rate is no change at all", () => {
    const lines = [line({ unit_cost: 5 })];
    expect(convertLines(lines, 655.957, 655.957)).toBe(lines);
  });
});

describe("priceNote — where a price came from, and what it was converted from", () => {
  it("names the rate card and the original figure", () => {
    expect(
      priceNote({ price_source: "EXPENSE_RATE", source_unit_cost: 72700, source_currency: "XAF" }),
    ).toMatch(/^From the rate card · 72,700\.00 XAF$/);
  });
  it("says so when there was nothing to convert with", () => {
    expect(priceNote({ price_source: "NO_FX", source_unit_cost: 100, source_currency: "GBP" })).toMatch(/GBP/);
  });
  it("a price already in the sheet's currency needs no 'from'", () => {
    expect(priceNote({ price_source: "CATALOGUE_DEFAULT" })).toBe("Catalogue default");
  });
});
