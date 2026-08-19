"use strict";

/**
 * §3.5 — cash request: the disbursement method with its conditional fields
 * (legacy cash-request.php :499, :505-514) and the voucher footer
 * Subtotal / VAT / TOTAL PAYABLE from per-line VAT.
 */
const {
  assertMethod,
  computeTotals,
} = require("../../src/modules/costing/cash_request/cash_request.rules");

describe("assertMethod — CASH / BANK / CHEQUE / MOMO with their own fields", () => {
  test("CASH needs nothing", () => {
    expect(assertMethod("CASH", {})).toEqual({ method: "CASH", details: {} });
  });

  test("BANK needs bank name, account number, account name (legacy :505-514)", () => {
    expect(() => assertMethod("BANK", { bank_name: "SGC" })).toThrow(
      /account_number/,
    );
    const ok = assertMethod("BANK", {
      bank_name: "SGC",
      account_number: "0012345",
      account_name: "PRAXIS SARL",
    });
    expect(ok.details).toEqual({
      bank_name: "SGC",
      account_number: "0012345",
      account_name: "PRAXIS SARL",
    });
  });

  test("MOMO needs number + network, and the network must be MTN or ORANGE", () => {
    expect(() => assertMethod("MOMO", { momo_number: "670000000" })).toThrow(
      /network/,
    );
    expect(() =>
      assertMethod("MOMO", { momo_number: "670000000", network: "AIRTEL" }),
    ).toThrow(/MTN or ORANGE/);
    expect(
      assertMethod("MOMO", { momo_number: "670000000", network: "mtn" }).details
        .network,
    ).toBe("MTN");
  });

  test("CHEQUE needs the cheque number", () => {
    expect(() => assertMethod("CHEQUE", {})).toThrow(/cheque_number/);
    expect(
      assertMethod("CHEQUE", { cheque_number: "CH-0091" }).details,
    ).toEqual({
      cheque_number: "CH-0091",
    });
  });

  test("only the method's own fields survive — no stale cheque under a transfer", () => {
    const out = assertMethod("BANK", {
      bank_name: "SGC",
      account_number: "1",
      account_name: "X",
      cheque_number: "CH-LEFTOVER",
    });
    expect(out.details.cheque_number).toBeUndefined();
  });

  test("an unknown method is refused", () => {
    expect(() => assertMethod("CRYPTO", {})).toThrow(
      /CASH, BANK, CHEQUE or MOMO/,
    );
  });
});

describe("computeTotals — Subtotal / VAT / TOTAL PAYABLE", () => {
  test("per-line VAT feeds the payable total", () => {
    const t = computeTotals([
      { budget_amount: 500000, vat_percent: 19.25 },
      { budget_amount: 100000 }, // no VAT
    ]);
    expect(t.subtotal).toBe(600000);
    expect(t.vat_total).toBe(96250);
    expect(t.total_payable).toBe(696250);
  });
  test("empty sheet totals zero, not NaN", () => {
    expect(computeTotals([])).toEqual({
      subtotal: 0,
      vat_total: 0,
      total_payable: 0,
    });
  });
});
