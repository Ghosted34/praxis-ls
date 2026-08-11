"use strict";
/**
 * Account-determination against the KB's own worked numbers:
 *  - §8.3/§24 ACME final invoice (services + 19.25% VAT + débours recovery)
 *  - §8.5 ordinary supplier invoice (expense + recoverable input VAT)
 * Pure, no DB.
 */
const { compute } = require("../../src/services/accounting/determination");

const sum = (lines, side) => Math.round(lines.reduce((a, l) => a + l[side], 0) * 100) / 100;

describe("determination — sale (final invoice, KB §8.3/§24 ACME)", () => {
  const { lines, totals } = compute({
    context: "sale",
    counterpartAccount: "4111",
    resolvedLines: [
      { amount: 1500000, creditAccount: "7061", taxRate: 19.25, taxCreditAccount: "4432", taxCodeId: "tva" },
      { amount: 500000, creditAccount: "7062", taxRate: 19.25, taxCreditAccount: "4432", taxCodeId: "tva" },
      { amount: 8000000, isDisbursement: true, creditAccount: "4731" },
    ],
  });

  it("computes turnover, VAT and débours per the KB", () => {
    expect(totals.subtotal_ht).toBe(2000000);
    expect(totals.tax_total).toBe(385000); // 2,000,000 x 19.25%
    expect(totals.disbursement_total).toBe(8000000);
    expect(totals.total).toBe(10385000);
  });

  it("debits 4111 the full total and balances", () => {
    const cp = lines.find((l) => l.account_code === "4111");
    expect(cp.debit).toBe(10385000);
    expect(sum(lines, "debit")).toBe(sum(lines, "credit"));
  });

  it("débours line carries is_disbursement and no VAT", () => {
    const deb = lines.find((l) => l.account_code === "4731");
    expect(deb.credit).toBe(8000000);
    expect(deb.is_disbursement).toBe(true);
    expect(deb.tax_code_id).toBeNull();
  });

  it("revenue lines credit 706x with output VAT to 4432", () => {
    expect(lines.filter((l) => l.account_code === "4432").reduce((a, l) => a + l.credit, 0)).toBe(385000);
    expect(lines.find((l) => l.account_code === "7061").credit).toBe(1500000);
  });
});

describe("determination — purchase (supplier invoice, KB §8.5)", () => {
  const { lines, totals } = compute({
    context: "purchase",
    counterpartAccount: "4011",
    resolvedLines: [
      { amount: 1000000, debitAccount: "6110", taxRate: 19.25, taxDebitAccount: "4452", taxCodeId: "tva" },
    ],
  });

  it("debits expense + recoverable VAT, credits supplier TTC, balances", () => {
    expect(totals.subtotal_ht).toBe(1000000);
    expect(totals.tax_total).toBe(192500);
    expect(totals.total).toBe(1192500);
    expect(lines.find((l) => l.account_code === "4011").credit).toBe(1192500);
    expect(sum(lines, "debit")).toBe(sum(lines, "credit"));
  });
});

describe("determination — guards", () => {
  it("rejects a débours line with no account", () => {
    expect(() => compute({ context: "sale", counterpartAccount: "4111", resolvedLines: [{ amount: 100, isDisbursement: true }] })).toThrow(/débours/i);
  });
  it("rejects an unknown context", () => {
    expect(() => compute({ context: "xfer", counterpartAccount: "4111", resolvedLines: [{ amount: 1 }] })).toThrow(/context/i);
  });
});

describe("determination — resolve (DB wiring, mocked client)", () => {
  const { resolve } = require("../../src/services/accounting/determination");

  function fakeClient(cfg) {
    return {
      query: async (sql) => {
        if (/FROM posting_rule/.test(sql)) return { rows: cfg.rule ? [cfg.rule] : [] };
        if (/is_disbursement FROM dictionary_item/.test(sql)) return { rows: [{ is_disbursement: !!cfg.itemDisbursement }] };
        if (/code, jurisdiction_id FROM tax_code/.test(sql)) return { rows: [{ code: "TVA", jurisdiction_id: "j1" }] };
        if (/FROM tax_code WHERE jurisdiction_id/.test(sql)) return { rows: cfg.effTax ? [cfg.effTax] : [] };
        return { rows: [] };
      },
    };
  }

  it("resolves a sale line through posting_rule + effective tax code", async () => {
    const c = fakeClient({
      rule: { debit_account: null, credit_account: "7061", tax_code_id: "tx-base", is_disbursement: false },
      effTax: { tax_code_id: "tx-v2026", rate_percent: 19.25, posts_credit_account: "4432", posts_debit_account: null },
    });
    const { totals, lines } = await resolve(c, {
      context: "sale",
      counterpartAccount: "4111",
      entryDate: "2026-02-01",
      lines: [{ dictionary_item_id: "i1", amount: 1000000 }],
    });
    expect(totals.tax_total).toBe(192500);
    expect(totals.total).toBe(1192500);
    const vat = lines.find((l) => l.account_code === "4432");
    expect(vat.credit).toBe(192500);
    expect(vat.tax_code_id).toBe("tx-v2026"); // stamped with the effective version
  });

  it("throws when no posting_rule exists for the item/context", async () => {
    const c = fakeClient({ rule: null });
    await expect(
      resolve(c, { context: "sale", counterpartAccount: "4111", entryDate: "2026-02-01", lines: [{ dictionary_item_id: "x", amount: 1 }] }),
    ).rejects.toThrow(/posting_rule/i);
  });
});
