"use strict";
const lead = require("../../src/modules/sales/lead/lead.rules");
const opp = require("../../src/modules/sales/opportunity/opportunity.events");
const proposal = require("../../src/modules/sales/proposal/proposal.rules");
const campaign = require("../../src/modules/sales/marketing_campaign/marketing_campaign.rules");
const qr = require("../../src/modules/sales/quote_request/quote_request.rules");

describe("Sales funnel rules (MOD-20–26)", () => {
  test("lead lifecycle", () => {
    expect(lead.assertTransition("NEW", "CONTACTED")).toBe(true);
    expect(lead.assertTransition("CONTACTED", "QUALIFIED")).toBe(true);
    expect(lead.assertTransition("QUALIFIED", "CONVERTED")).toBe(true);
    expect(() => lead.assertTransition("NEW", "CONVERTED")).toThrow();
    expect(() => lead.assertTransition("LOST", "CONTACTED")).toThrow();
  });
  test("proposal lifecycle + total", () => {
    expect(proposal.assertTransition("DRAFT", "IN_REVIEW")).toBe(true);
    expect(proposal.assertTransition("SENT", "ACCEPTED")).toBe(true);
    expect(() => proposal.assertTransition("DRAFT", "SENT")).toThrow();
    expect(
      proposal.totalHt([
        { qty: 2, unit_price: 100 },
        { qty: 1, unit_price: 50.5 },
      ]),
    ).toBe(250.5);
  });
  test("campaign lifecycle", () => {
    expect(campaign.assertTransition("DRAFT", "ACTIVE")).toBe(true);
    expect(campaign.assertTransition("ACTIVE", "PAUSED")).toBe(true);
    expect(() => campaign.assertTransition("ENDED", "ACTIVE")).toThrow();
  });
  test("opportunity emits stage/won/lost events", () => {
    expect(opp.WON).toBe("opportunity.won");
    expect(opp.STAGE_MOVED).toBe("opportunity.stage_moved");
  });
});

/**
 * F6 (SALES_CRM_FEATURES.md#F6) — quote_request intake lifecycle.
 *
 * The architectural correction that defines this feature: intake status
 * values are a separate state machine from the pipeline stages on
 * `opportunity`. They share NO states. The rules below are the
 * quote_request-side half; the pipeline side is tested in
 * `tests/unit/opportunity.test.js` (if it exists) and is governed by
 * `opportunity.rules`.
 */
describe("Quote request intake lifecycle (F6, MOD-20-intake)", () => {
  test("happy path RECEIVED -> UNDER_REVIEW -> QUOTED -> CONVERTED", () => {
    expect(qr.assertTransition("RECEIVED", "UNDER_REVIEW")).toBe(true);
    expect(qr.assertTransition("UNDER_REVIEW", "QUOTED")).toBe(true);
    expect(qr.assertTransition("QUOTED", "CONVERTED_TO_OPPORTUNITY")).toBe(true);
  });
  test("clarification loop", () => {
    expect(qr.assertTransition("RECEIVED", "CLARIFICATION_REQUIRED")).toBe(true);
    expect(qr.assertTransition("UNDER_REVIEW", "CLARIFICATION_REQUIRED")).toBe(true);
    expect(qr.assertTransition("CLARIFICATION_REQUIRED", "UNDER_REVIEW")).toBe(true);
  });
  test("terminal states cannot be re-opened", () => {
    expect(() => qr.assertTransition("CONVERTED_TO_OPPORTUNITY", "UNDER_REVIEW")).toThrow();
    expect(() => qr.assertTransition("CONVERTED_TO_OPPORTUNITY", "CLOSED_NO_ACTION")).toThrow();
    expect(() => qr.assertTransition("CLOSED_NO_ACTION", "RECEIVED")).toThrow();
  });
  test("QUOTED can be closed without conversion", () => {
    expect(qr.assertTransition("QUOTED", "CLOSED_NO_ACTION")).toBe(true);
  });
  test("RECEIVED cannot skip straight to CONVERTED — the legacy bug", () => {
    // The legacy let you write any status via POST with no guard; the new
    // system refuses the skipped state explicitly.
    expect(() => qr.assertTransition("RECEIVED", "CONVERTED_TO_OPPORTUNITY")).toThrow();
  });
  test("all 5 KPI tiles are covered by the status enum", () => {
    expect(new Set(qr.STATUSES)).toEqual(
      new Set(["RECEIVED", "UNDER_REVIEW", "CLARIFICATION_REQUIRED", "QUOTED", "CONVERTED_TO_OPPORTUNITY", "CLOSED_NO_ACTION"]),
    );
    // The 5 tiles are the user-facing summary; CLARIFICATION_REQUIRED and
    // CLOSED_NO_ACTION are intentional extras (more granular lifecycle)
    // whose counts are surfaced in the dynamic kpi object but not in the
    // 5-tile summary. The legacy had the same split.
    expect(new Set(qr.KPI_TILES)).toEqual(
      new Set(["TOTAL", "RECEIVED", "UNDER_REVIEW", "QUOTED", "CONVERTED_TO_OPPORTUNITY"]),
    );
  });
});
