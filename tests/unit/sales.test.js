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
  // F8 put approval in front of ACTIVE: DRAFT -> ACTIVE no longer exists, and
  // PENDING_APPROVAL is left through approve/reject rather than a transition.
  // The full lifecycle, field locks and KPI arithmetic are in
  // tests/unit/campaign-lifecycle.test.js.
  test("campaign lifecycle", () => {
    expect(campaign.assertTransition("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(campaign.assertDecision("PENDING_APPROVAL", "APPROVE")).toBe("ACTIVE");
    expect(campaign.assertTransition("ACTIVE", "PAUSED")).toBe(true);
    expect(() => campaign.assertTransition("DRAFT", "ACTIVE")).toThrow();
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
  /**
   * THE TILES PARTITION THE SET — one tile per status, plus TOTAL, and they add
   * up.
   *
   * This test previously asserted a hand-listed FIVE tiles and explained the
   * two missing ones as "intentional extras... whose counts are surfaced in the
   * dynamic kpi object but not in the 5-tile summary. The legacy had the same
   * split." That is a description of the bug, not of a design: every
   * CLARIFICATION_REQUIRED and CLOSED_NO_ACTION row counted into TOTAL and was
   * displayed in no tile, so the register disagreed with itself — which is the
   * legacy's "5 of 26 rows" defect reproduced one column over, and the thing F6
   * exists to correct.
   *
   * `quote_request.rules` now DERIVES the tiles from the status list so a
   * seventh status cannot silently vanish from the summary. Asserting a
   * hard-coded list here would defeat that: the point is that nobody maintains
   * the list. So what is asserted is the invariant instead — every status gets
   * a tile, every tile gets a label, and the counts add up to TOTAL.
   */
  test("the KPI tiles are derived from the status enum, and partition it", () => {
    expect(new Set(qr.STATUSES)).toEqual(
      new Set(["RECEIVED", "UNDER_REVIEW", "CLARIFICATION_REQUIRED", "QUOTED", "CONVERTED_TO_OPPORTUNITY", "CLOSED_NO_ACTION"]),
    );
    // TOTAL plus one tile per status — derived, not listed.
    expect(new Set(qr.KPI_TILES)).toEqual(new Set(["TOTAL", ...qr.STATUSES]));
    expect(qr.KPI_TILES).toHaveLength(qr.STATUSES.length + 1);
    // A tile with no caption renders as a blank card, so the labels are part of
    // the contract rather than a display detail.
    for (const key of qr.KPI_TILES) expect(typeof qr.TILE_LABELS[key]).toBe("string");
  });

  test("every row lands in exactly one tile, and the tiles sum to TOTAL", () => {
    const kpi = qr.kpiFrom([
      { status: "RECEIVED", c: 2 },
      { status: "UNDER_REVIEW", c: 1 },
      { status: "CLARIFICATION_REQUIRED", c: 1 },
      { status: "QUOTED", c: 1 },
      { status: "CONVERTED_TO_OPPORTUNITY", c: 1 },
      { status: "CLOSED_NO_ACTION", c: 1 },
    ]);
    expect(kpi.TOTAL).toBe(7);
    // The two the old assertion dropped are counted and displayed, not absorbed.
    expect(kpi.CLARIFICATION_REQUIRED).toBe(1);
    expect(kpi.CLOSED_NO_ACTION).toBe(1);
    expect(qr.assertPartitions(kpi)).toBe(true);
    expect(qr.STATUSES.reduce((n, s) => n + kpi[s], 0)).toBe(kpi.TOTAL);
  });

  test("a status the enum does not know shows up as a discrepancy, never as a silent loss", () => {
    // The CHECK constraint should make this impossible, but a value written by
    // a hand-run UPDATE has to appear on the screen rather than quietly
    // unbalancing the tiles — counters that fail to add up is the whole defect.
    const kpi = qr.kpiFrom([{ status: "RECEIVED", c: 2 }, { status: "LEGACY_SP_NEW", c: 3 }]);
    expect(kpi.TOTAL).toBe(5);
    expect(kpi.OTHER).toBe(3);
    expect(qr.assertPartitions(kpi)).toBe(true);
  });
});
