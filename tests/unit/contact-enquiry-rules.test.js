"use strict";
/**
 * F9 (SALES_CRM_FEATURES.md#F9) — contact enquiry desk: lifecycle and the KPI
 * partition invariant.
 *
 * THE THING THIS FILE EXISTS TO PROVE. The legacy renders four tiles (Total /
 * New (unread) / Responded / Closed) over four statuses (NEW / READ /
 * RESPONDED / CLOSED). READ is in no tile, so an opened-but-unanswered message
 * is counted into Total and displayed nowhere, and the three sub-tiles do not
 * sum to the first. F9's definition of done is "every enquiry falls into
 * exactly one KPI tile" — so the assertion below is the feature, not a
 * formality, and it is written to fail if someone adds a fifth status and
 * forgets its tile.
 */
const rules = require("../../src/modules/sales/inbound_intake/inbound_intake.rules");
const events = require("../../src/modules/sales/inbound_intake/inbound_intake.events");

describe("Contact enquiry correspondence lifecycle (F9, MOD-25)", () => {
  test("happy path NEW -> READ -> RESPONDED -> CLOSED", () => {
    expect(rules.assertTransition("NEW", "READ")).toBe(true);
    expect(rules.assertTransition("READ", "RESPONDED")).toBe(true);
    expect(rules.assertTransition("RESPONDED", "CLOSED")).toBe(true);
  });

  test("answering from the list, without opening first, is legal", () => {
    expect(rules.assertTransition("NEW", "RESPONDED")).toBe(true);
  });

  test("CLOSED is not terminal — it reopens to READ, and to nothing else", () => {
    expect(rules.assertTransition("CLOSED", "READ")).toBe(true);
    expect(() => rules.assertTransition("CLOSED", "RESPONDED")).toThrow();
    expect(() => rules.assertTransition("CLOSED", "NEW")).toThrow();
  });

  test("nothing goes back to NEW — unread is a fact about the past", () => {
    for (const from of rules.STATUSES) {
      expect(rules.NEXT[from]).not.toContain("NEW");
    }
  });

  test("TRIAGED is gone from the vocabulary entirely", () => {
    // The whole point of 0689: it was never a state of the correspondence, and
    // while it occupied the column there was nowhere to record a reply.
    expect(rules.STATUSES).not.toContain("TRIAGED");
    expect(rules.NEXT.TRIAGED).toBeUndefined();
    expect(() => rules.assertTransition("READ", "TRIAGED")).toThrow();
  });

  test("reopening logs as reopened, not as a second read", () => {
    expect(events.enquiryTransition("CLOSED", "READ")).toBe("contact_enquiry.reopened");
    expect(events.enquiryTransition("NEW", "READ")).toBe("contact_enquiry.read");
  });

  test("'was this triaged' is answered by the FKs and nothing else", () => {
    expect(rules.isTriaged({ status: "READ" })).toBe(false);
    expect(rules.isTriaged({ lead_id: "abc" })).toBe(true);
    expect(rules.isTriaged({ partnership_request_id: "def" })).toBe(true);
    // Not by a status value — there is no status that means "triaged".
    expect(rules.isTriaged({ status: "RESPONDED" })).toBe(false);
  });
});

describe("Contact enquiry KPI tiles partition the set (F9)", () => {
  const rowsFor = (counts) =>
    Object.entries(counts).map(([status, c]) => ({ status, c }));

  test("one tile per status, plus TOTAL, derived from the status list", () => {
    expect(rules.KPI_TILES).toEqual(["TOTAL", ...rules.STATUSES]);
    // Every tile has a caption. A tile the screen cannot label is a tile the
    // screen will quietly drop.
    for (const k of rules.KPI_TILES) expect(rules.TILE_LABELS[k]).toBeTruthy();
  });

  test("the legacy's four tiles are all present — READ is the addition", () => {
    for (const k of ["TOTAL", "NEW", "RESPONDED", "CLOSED"]) {
      expect(rules.KPI_TILES).toContain(k);
    }
    expect(rules.KPI_TILES).toContain("READ");
  });

  test("tiles sum to TOTAL for every distribution", () => {
    const kpi = rules.kpiFrom(rowsFor({ NEW: 3, READ: 5, RESPONDED: 2, CLOSED: 7 }));
    expect(kpi.TOTAL).toBe(17);
    expect(kpi.NEW).toBe(3);
    expect(kpi.READ).toBe(5);
    expect(rules.assertPartitions(kpi)).toBe(true);
  });

  test("a status with no rows renders 0 rather than disappearing", () => {
    const kpi = rules.kpiFrom(rowsFor({ NEW: 1 }));
    for (const s of rules.STATUSES) expect(typeof kpi[s]).toBe("number");
    expect(kpi.CLOSED).toBe(0);
    expect(rules.assertPartitions(kpi)).toBe(true);
  });

  test("an empty register is all zeroes and still partitions", () => {
    const kpi = rules.kpiFrom([]);
    expect(kpi.TOTAL).toBe(0);
    expect(rules.assertPartitions(kpi)).toBe(true);
  });

  /**
   * The legacy failure mode, reproduced deliberately. A row carrying a status
   * no tile knows — TRIAGED on a database the 0689 UPDATE has not reached — is
   * counted into TOTAL and into OTHER, never dropped, so the discrepancy
   * appears on the screen instead of silently unbalancing the tiles.
   */
  test("an unrecognised status lands in OTHER, is counted in TOTAL, and still balances", () => {
    const kpi = rules.kpiFrom(rowsFor({ NEW: 2, TRIAGED: 4 }));
    expect(kpi.TOTAL).toBe(6);
    expect(kpi.OTHER).toBe(4);
    expect(rules.assertPartitions(kpi)).toBe(true);
  });

  test("assertPartitions THROWS when the tiles stop adding up", () => {
    // Hand-built to be wrong: 5 rows in TOTAL, 3 accounted for. This is what a
    // hand-listed tile set produces the day a status is added, and it must be a
    // failure rather than a plausible-looking screen.
    expect(() => rules.assertPartitions({ TOTAL: 5, NEW: 3, READ: 0, RESPONDED: 0, CLOSED: 0 }))
      .toThrow(/KPI_NOT_PARTITIONED|belongs to no tile/);
  });

  test("every enquiry type the register filters on has a label", () => {
    expect(rules.ENQUIRY_TYPES).toEqual(["GENERAL_ENQUIRY", "PARTNERSHIP", "CAREERS", "MEDIA"]);
    for (const t of rules.ENQUIRY_TYPES) expect(rules.TYPE_LABELS[t]).toBeTruthy();
  });
});
