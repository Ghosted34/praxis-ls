"use strict";

/**
 * §2.7 — an invoice line may not invent its own price.
 *
 * The bypass: `PATCH /final-invoices/:id` took arbitrary lines at arbitrary
 * prices, with nothing comparing them to the accepted quotation. That is how
 * costing COST figures reached invoice fb7db2f3 (95,700,000 XAF, at cost, no
 * VAT). §2.2 stopped the numbers being mangled in transit; this stops the wrong
 * numbers being accepted at all.
 */

const {
  reconcileAgainstQuotation,
} = require("../../src/modules/finance/final_invoice/final_invoice.rules");

const UUID = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

// The quotation as the client accepted it.
const QUOTED = [
  { dictionary_item_id: UUID(1), label: "Fret maritime 40ft", qty: 40, unit_price: 2600000, is_disbursement: false, container_type_ref_id: null },
  { dictionary_item_id: UUID(2), label: "Droits de douane", qty: 1, unit_price: 8500000, is_disbursement: true, container_type_ref_id: null },
  { dictionary_item_id: UUID(3), label: "THC", qty: 40, unit_price: 210000, is_disbursement: false, container_type_ref_id: null },
];

describe("reconcileAgainstQuotation — the price is the quotation's (§2.7)", () => {
  it("passes lines billed exactly as quoted", () => {
    const r = reconcileAgainstQuotation(
      [
        { dictionary_item_id: UUID(1), qty: 40, unit_price: 2600000, is_disbursement: false },
        { dictionary_item_id: UUID(3), qty: 40, unit_price: 210000, is_disbursement: false },
      ],
      QUOTED,
    );
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("catches the fb7db2f3 shape — cost billed as price", () => {
    // The costing's unit COSTS, not the quotation's prices.
    const r = reconcileAgainstQuotation(
      [
        { dictionary_item_id: UUID(1), label: "Fret maritime 40ft", qty: 40, unit_price: 2000000, is_disbursement: false },
        { dictionary_item_id: UUID(3), label: "THC", qty: 40, unit_price: 180000, is_disbursement: false },
      ],
      QUOTED,
    );
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(2);
    expect(r.violations[0].code).toBe("PRICE_MISMATCH");
    expect(r.violations[0].quoted).toBe(2600000);
    expect(r.violations[0].billed).toBe(2000000);
    // Every violation, not just the first — fixing one line at a time against
    // a silent endpoint is how an afternoon disappears.
    expect(r.violations[1].code).toBe("PRICE_MISMATCH");
  });

  it("refuses a charge that is not on the quotation at all", () => {
    const r = reconcileAgainstQuotation(
      [{ dictionary_item_id: UUID(9), label: "Mystery handling", qty: 1, unit_price: 750000 }],
      QUOTED,
    );
    expect(r.violations[0].code).toBe("NOT_QUOTED");
    expect(r.violations[0].message).toContain("Mystery handling");
  });

  it("refuses re-billing a quoted disbursement as taxable revenue", () => {
    const r = reconcileAgainstQuotation(
      [{ dictionary_item_id: UUID(2), label: "Droits de douane", qty: 1, unit_price: 8500000, is_disbursement: false }],
      QUOTED,
    );
    expect(r.violations[0].code).toBe("NATURE_MISMATCH");
    expect(r.violations[0].quoted).toBe("disbursement");
  });

  it("lets QUANTITY vary — 38 boxes cleared against 40 quoted is a fact, not a violation", () => {
    const r = reconcileAgainstQuotation(
      [{ dictionary_item_id: UUID(1), qty: 38, unit_price: 2600000, is_disbursement: false }],
      QUOTED,
    );
    expect(r.ok).toBe(true);
  });

  it("tolerates a centime of rounding but not a repricing", () => {
    expect(
      reconcileAgainstQuotation([{ dictionary_item_id: UUID(3), qty: 1, unit_price: 210000.01, is_disbursement: false }], QUOTED).ok,
    ).toBe(true);
    expect(
      reconcileAgainstQuotation([{ dictionary_item_id: UUID(3), qty: 1, unit_price: 210500, is_disbursement: false }], QUOTED).ok,
    ).toBe(false);
  });

  it("reads the deprecated `amount` shape as one unit at that price", () => {
    expect(
      reconcileAgainstQuotation([{ dictionary_item_id: UUID(3), amount: 210000, is_disbursement: false }], QUOTED).ok,
    ).toBe(true);
  });

  it("distinguishes the same charge priced per container type (0663)", () => {
    // THC on a 20' and a 40' are different prices; collapsing them would let
    // the cheaper line justify the dearer one.
    const perBox = [
      { dictionary_item_id: UUID(3), label: "THC", qty: 10, unit_price: 150000, is_disbursement: false, container_type_ref_id: UUID(20) },
      { dictionary_item_id: UUID(3), label: "THC", qty: 30, unit_price: 210000, is_disbursement: false, container_type_ref_id: UUID(40) },
    ];
    expect(
      reconcileAgainstQuotation([{ dictionary_item_id: UUID(3), qty: 30, unit_price: 210000, container_type_ref_id: UUID(40) }], perBox).ok,
    ).toBe(true);
    // billing the 40' line at the 20' price
    expect(
      reconcileAgainstQuotation([{ dictionary_item_id: UUID(3), qty: 30, unit_price: 150000, container_type_ref_id: UUID(40) }], perBox).ok,
    ).toBe(false);
  });

  it("an empty invoice has nothing to reconcile", () => {
    expect(reconcileAgainstQuotation([], QUOTED).ok).toBe(true);
  });
});
