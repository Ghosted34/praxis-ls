"use strict";
/**
 * The 10721 gap-closers: cash-request two-step approval, PO direct payment
 * (legacy po_mark_paid), PO unlock loop, and SI reversal rules.
 */
const poRules = require("../../src/modules/procurement/purchase_order/purchase_order.rules");
const si = require("../../src/modules/procurement/supplier_invoice/supplier_invoice.rules");
const crRules = require("../../src/modules/costing/cash_request/cash_request.rules");

describe("cash request two-step approval (10721)", () => {
  test("SUBMITTED validates, VALIDATED approves — never SUBMITTED → APPROVED", () => {
    expect(crRules.assertTransition("SUBMITTED", "VALIDATED")).toBe(true);
    expect(crRules.assertTransition("VALIDATED", "APPROVED")).toBe(true);
    expect(() => crRules.assertTransition("SUBMITTED", "APPROVED")).toThrow();
    expect(() => crRules.assertTransition("DRAFT", "VALIDATED")).toThrow();
  });
  test("REJECTED is reachable from both SUBMITTED and VALIDATED", () => {
    expect(crRules.assertTransition("SUBMITTED", "REJECTED")).toBe(true);
    expect(crRules.assertTransition("VALIDATED", "REJECTED")).toBe(true);
  });
  test("the disbursed states still follow APPROVED", () => {
    expect(crRules.NEXT.APPROVED).toEqual(
      expect.arrayContaining(["PARTIALLY_DISBURSED", "DISBURSED", "REJECTED"]),
    );
  });
});

describe("PO direct payment (10721, legacy po_mark_paid)", () => {
  test("poPayState derives PARTIAL then PAID from the money, not a decision", () => {
    expect(poRules.poPayState("APPROVED_LOCKED", 1000, 0)).toBe("APPROVED_LOCKED");
    expect(poRules.poPayState("APPROVED_LOCKED", 1000, 400)).toBe("PARTIAL");
    expect(poRules.poPayState("APPROVED_LOCKED", 1000, 1000)).toBe("PAID");
    expect(poRules.poPayState("PARTIAL", 1000, 1000)).toBe("PAID");
  });
  test("a fully paid RECEIVED PO closes; a partly paid one keeps its delivery state", () => {
    expect(poRules.poPayState("RECEIVED", 1000, 1000)).toBe("CLOSED");
    expect(poRules.poPayState("RECEIVED", 1000, 400)).toBe("RECEIVED");
  });
  test("over-payment is refused, not clamped", () => {
    expect(() => poRules.poPayState("APPROVED_LOCKED", 1000, 1000.01)).toThrow();
  });
  test("the lifecycle admits the payment states", () => {
    expect(poRules.NEXT.APPROVED_LOCKED).toEqual(
      expect.arrayContaining(["RECEIVED", "PARTIAL", "PAID", "CANCELLED"]),
    );
    expect(poRules.NEXT.PARTIAL).toEqual(expect.arrayContaining(["PAID", "RECEIVED"]));
    expect(poRules.NEXT.PAID).toEqual([]);
  });
});

describe("PO unlock loop (10721, mirroring costing 10718)", () => {
  test("REQUEST_UNLOCK parks in UNLOCK_REQUESTED; UNLOCK returns to DRAFT; DENY goes back", () => {
    expect(poRules.UNLOCK_FLOW.REQUEST_UNLOCK).toEqual({ from: "APPROVED_LOCKED", to: "UNLOCK_REQUESTED" });
    expect(poRules.UNLOCK_FLOW.UNLOCK).toEqual({ from: "UNLOCK_REQUESTED", to: "DRAFT" });
    expect(poRules.UNLOCK_FLOW.DENY_UNLOCK).toEqual({ from: "UNLOCK_REQUESTED", to: "APPROVED_LOCKED" });
  });
  test("UNLOCK_REQUESTED is not a route into the normal flow", () => {
    expect(() => poRules.assertTransition("UNLOCK_REQUESTED", "RECEIVED")).toThrow();
    expect(() => poRules.assertTransition("UNLOCK_REQUESTED", "CLOSED")).toThrow();
  });
});

describe("supplier invoice reversal (10721)", () => {
  test("payState is unchanged: POSTED_LOCKED until paid in full, then PAID", () => {
    expect(si.payState(1000, 0)).toBe("POSTED_LOCKED");
    expect(si.payState(1000, 999.99)).toBe("POSTED_LOCKED");
    expect(si.payState(1000, 1000)).toBe("PAID");
  });
});
