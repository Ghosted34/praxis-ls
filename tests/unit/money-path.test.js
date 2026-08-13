"use strict";

/**
 * TC-C5 and TC-Q4 — the money path, tested without mocking the money away.
 *
 * TC-C5: the money services had 0% function coverage; only the rules layer was
 * tested. TC-Q4 is sharper and explains why the first was easy to miss:
 * `final-invoice-lifecycle.test.js` DOES exercise the invoice lifecycle, but it
 * mocks `determination` and `journal_entry.service`, so the two things that
 * decide what hits the ledger are replaced by fixtures. It asserts the
 * lifecycle transitions correctly and asserts nothing about the accounting.
 *
 * That test is not wrong — a lifecycle test should mock the ledger. What was
 * missing is the other half, and this is it: `determination.compute` run for
 * real, against OHADA account codes, with the arithmetic checked to the centime.
 *
 * WHY THE CENTIME MATTERS ENOUGH TO TEST
 *
 * `compute` works in integer cents and converts back at the edges. That is the
 * correct design and it is also the one that fails invisibly: a rounding error
 * does not throw, it produces an entry that is off by 0.01 and still balances,
 * or one that does not balance and is rejected by a trigger hours later during
 * posting. Neither says "rounding" anywhere.
 *
 * The balance assertion is the load-bearing one. `assert_entry_balanced` in the
 * database is the final authority, but it fires at INSERT time — by then the
 * caller is mid-transaction and the failure surfaces as a 500 from deep inside
 * a posting. Catching it here is the difference between a failing test and a
 * failed invoice.
 */

const determination = require("../../src/services/accounting/determination");

/** Sum both sides of a computed leg set, in centimes, as integers. */
function sides(legs) {
  const cents = (v) => Math.round(Number(v) * 100);
  return {
    debit: legs.reduce((a, l) => a + cents(l.debit), 0),
    credit: legs.reduce((a, l) => a + cents(l.credit), 0),
  };
}

const saleLine = (over = {}) => ({
  amount: 1_000_000,
  creditAccount: "706",
  taxRate: 19.25,
  taxCreditAccount: "4432",
  taxCodeId: "tax-tva",
  dictionaryItemId: "dict-1",
  ...over,
});

const purchaseLine = (over = {}) => ({
  amount: 500_000,
  debitAccount: "601",
  taxRate: 19.25,
  taxDebitAccount: "4452",
  taxCodeId: "tax-tva",
  ...over,
});

describe("determination.compute — sales (TC-C5, TC-Q4)", () => {
  it("balances a single taxed service line", () => {
    const out = determination.compute({
      context: "sale",
      counterpartAccount: "4111",
      resolvedLines: [saleLine()],
    });
    const { debit, credit } = sides(out.lines);
    expect(debit).toBe(credit);
  });

  it("computes Cameroonian VAT at 19.25% to the centime", () => {
    const out = determination.compute({
      context: "sale",
      counterpartAccount: "4111",
      resolvedLines: [saleLine({ amount: 1_000_000 })],
    });
    // 1,000,000 × 19.25% = 192,500 exactly.
    expect(out.totals.tax_total).toBe(192500);
    expect(out.totals.subtotal_ht).toBe(1000000);
    expect(out.totals.total).toBe(1192500);
  });

  it("puts the receivable on the DEBIT side of a sale", () => {
    // Getting this backwards inverts the balance sheet and still "balances".
    const out = determination.compute({
      context: "sale",
      counterpartAccount: "4111",
      resolvedLines: [saleLine()],
    });
    const receivable = out.lines.find((l) => l.account_code === "4111");
    expect(Number(receivable.debit)).toBe(1192500);
    expect(Number(receivable.credit)).toBe(0);
  });

  it("credits revenue and output VAT to their own accounts", () => {
    const out = determination.compute({
      context: "sale",
      counterpartAccount: "4111",
      resolvedLines: [saleLine()],
    });
    const revenue = out.lines.find((l) => l.account_code === "706");
    const vat = out.lines.find((l) => l.account_code === "4432");
    expect(Number(revenue.credit)).toBe(1000000);
    expect(Number(vat.credit)).toBe(192500);
    expect(vat.tax_code_id).toBe("tax-tva");
  });

  it("keeps a débours line OUT of the taxable base", () => {
    // A débours is a disbursement made on the client's behalf. Taxing it would
    // overcharge the client and overstate output VAT to the revenue authority
    // — a filing error, not just an invoice error.
    const out = determination.compute({
      context: "sale",
      counterpartAccount: "4111",
      resolvedLines: [
        saleLine({ amount: 1_000_000 }),
        { amount: 250_000, isDisbursement: true, creditAccount: "4731" },
      ],
    });
    expect(out.totals.subtotal_ht).toBe(1000000);
    expect(out.totals.disbursement_total).toBe(250000);
    expect(out.totals.tax_total).toBe(192500); // unchanged by the débours
    expect(out.totals.total).toBe(1442500);
    const { debit, credit } = sides(out.lines);
    expect(debit).toBe(credit);
  });

  it("flags the débours leg so it can be reported separately", () => {
    const out = determination.compute({
      context: "sale",
      counterpartAccount: "4111",
      resolvedLines: [
        { amount: 250_000, isDisbursement: true, creditAccount: "4731" },
      ],
    });
    const leg = out.lines.find((l) => l.account_code === "4731");
    expect(leg.is_disbursement).toBe(true);
  });

  it("balances an untaxed line", () => {
    const out = determination.compute({
      context: "sale",
      counterpartAccount: "4111",
      resolvedLines: [saleLine({ taxRate: 0, taxCreditAccount: null })],
    });
    expect(out.totals.tax_total).toBe(0);
    const { debit, credit } = sides(out.lines);
    expect(debit).toBe(credit);
  });

  it("balances many lines with rates that do not divide evenly", () => {
    // The rounding case. Each line's VAT rounds independently, so the
    // counterpart must be the SUM of the rounded parts, not a rounding of the
    // sum — those differ, and the difference is exactly what breaks the ledger.
    const odd = [333_33, 666_67, 1_00, 99_99, 12_345].map((amount) =>
      saleLine({ amount: amount / 100 }),
    );
    const out = determination.compute({
      context: "sale",
      counterpartAccount: "4111",
      resolvedLines: odd,
    });
    const { debit, credit } = sides(out.lines);
    expect(debit).toBe(credit);
  });

  it("never emits a zero-value leg", () => {
    // A zero leg is noise in the ledger and some reports treat it as an error.
    const out = determination.compute({
      context: "sale",
      counterpartAccount: "4111",
      resolvedLines: [saleLine({ taxRate: 0, taxCreditAccount: null })],
    });
    for (const l of out.lines) {
      expect(Number(l.debit) + Number(l.credit)).toBeGreaterThan(0);
    }
  });
});

describe("determination.compute — purchases", () => {
  it("mirrors the sale: expense and input VAT on DEBIT, payable on CREDIT", () => {
    const out = determination.compute({
      context: "purchase",
      counterpartAccount: "4011",
      resolvedLines: [purchaseLine()],
    });
    const expense = out.lines.find((l) => l.account_code === "601");
    const vat = out.lines.find((l) => l.account_code === "4452");
    const payable = out.lines.find((l) => l.account_code === "4011");
    expect(Number(expense.debit)).toBe(500000);
    expect(Number(vat.debit)).toBe(96250); // 500,000 × 19.25%
    expect(Number(payable.credit)).toBe(596250);
    const { debit, credit } = sides(out.lines);
    expect(debit).toBe(credit);
  });
});

describe("determination.compute — refusals", () => {
  const cases = [
    [
      "an unknown context",
      {
        context: "gift",
        counterpartAccount: "4111",
        resolvedLines: [saleLine()],
      },
      "BAD_CONTEXT",
    ],
    [
      "no counterpart account",
      {
        context: "sale",
        counterpartAccount: null,
        resolvedLines: [saleLine()],
      },
      "NO_COUNTERPART",
    ],
    [
      "no lines at all",
      { context: "sale", counterpartAccount: "4111", resolvedLines: [] },
      "NO_LINES",
    ],
    [
      "a zero-amount line",
      {
        context: "sale",
        counterpartAccount: "4111",
        resolvedLines: [saleLine({ amount: 0 })],
      },
      "ZERO_LINE",
    ],
    [
      "a service line with no revenue account",
      {
        context: "sale",
        counterpartAccount: "4111",
        resolvedLines: [saleLine({ creditAccount: null })],
      },
      "NO_REVENUE_ACCOUNT",
    ],
    [
      "a débours with no credit account",
      {
        context: "sale",
        counterpartAccount: "4111",
        resolvedLines: [{ amount: 100, isDisbursement: true }],
      },
      "NO_DISBURSEMENT_ACCOUNT",
    ],
    [
      "a taxed line with no VAT account",
      {
        context: "sale",
        counterpartAccount: "4111",
        resolvedLines: [saleLine({ taxCreditAccount: null })],
      },
      "NO_VAT_ACCOUNT",
    ],
    [
      "a purchase with no expense account",
      {
        context: "purchase",
        counterpartAccount: "4011",
        resolvedLines: [purchaseLine({ debitAccount: null })],
      },
      "NO_EXPENSE_ACCOUNT",
    ],
    [
      "a taxed purchase with no input-VAT account",
      {
        context: "purchase",
        counterpartAccount: "4011",
        resolvedLines: [purchaseLine({ taxDebitAccount: null })],
      },
      "NO_VAT_ACCOUNT",
    ],
  ];

  for (const [label, input, code] of cases) {
    it(`refuses ${label} with ${code}`, () => {
      // Refusing BEFORE the database is the point. Every one of these would
      // otherwise reach assert_entry_balanced or a NOT NULL and surface as a
      // 500 from inside a posting, with no indication of which line was wrong.
      let err = null;
      try {
        determination.compute(input);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err.code).toBe(code);
      expect(err.status).toBe(422);
    });
  }
});

describe("determination.toCents — the boundary the rest depends on", () => {
  it("converts without floating-point drift", () => {
    // 0.1 + 0.2 !== 0.3 is why this function exists.
    expect(determination.toCents(0.1)).toBe(10);
    expect(determination.toCents(1234.56)).toBe(123456);
    expect(determination.toCents("1234.56")).toBe(123456);
    expect(determination.toCents(0)).toBe(0);
  });

  it("REFUSES sub-centime precision rather than silently rounding it", () => {
    // I expected this to round. It does not, and refusing is the better
    // contract: XAF has no sub-unit in practice, and an amount carrying a third
    // of a centime came from somewhere — a bad division, a foreign-currency
    // conversion applied too early, a spreadsheet import. Rounding it away
    // makes the invoice total disagree with its source by an amount nobody can
    // trace. Refusing sends it back to whoever produced it.
    let err = null;
    try {
      determination.toCents(0.005);
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect(err.message).toContain("2 decimals");
  });

  it("accepts exactly two decimals, and REFUSES a negative amount", () => {
    expect(determination.toCents(0.99)).toBe(99);
    // Also stricter than I assumed. A negative line amount is refused rather
    // than posted as a contra: reducing a sale is a credit note, which is a
    // document with its own number and its own ledger entry. Letting a negative
    // line through would produce the same net effect with no document behind
    // it — invisible to the sequential-numbering that statutory reporting
    // depends on.
    let err = null;
    try {
      determination.toCents(-1.5);
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect(err.message).toContain("non-negative");
  });
});
