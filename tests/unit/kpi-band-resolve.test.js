/**
 * The band resolver — precedence, locks, shrink, zeros.
 *
 * The whole guide lives in this file's assertions: D2 fixed four (no fifth
 * slot, ever), D3 the zero policy, D8 shrink-and-never-pad, §4.2 read-time
 * filtering so a revoked grant retires its tile without a migration, and the
 * null-vs-empty preference doctrine applied to a band ("never chosen" follows
 * the role, "cleared" paints nothing). Each test names the decision it pins
 * by the guide's own label, so a future editor who wants to break one must
 * edit the decision record to do it.
 *
 * These are the pure halves — `selectBand`, `paintBand`, `pickerModel`,
 * `keepEligible` — fed with plain objects. The wiring to the database (which
 * is where a resolver bug would hide if it lived HERE, not in the rule) is
 * `kpi-band-endpoints.test.js`.
 */
"use strict";

const {
  MAX_BAND_TILES,
  SYSTEM_DEFAULT_IDS,
  keepEligible,
  selectBand,
  paintBand,
  pickerModel,
} = require("../../src/modules/dashboard/kpi_catalog/resolve");
const { LIVE_IDS, CATALOG, BY_ID } = require("../../src/modules/dashboard/kpi_catalog");
const { eligibleIds } = require("../../src/modules/dashboard/kpi_catalog/eligibility");

const ALL = new Set(LIVE_IDS);
const val = (over = {}) => ({ ...Object.fromEntries(LIVE_IDS.map((id) => [id, 0])), ...over });

describe("keepEligible", () => {
  it("drops unknown, hidden, and ineligible ids, preserves order, dedupes", () => {
    // The hidden half of this assertion needs an id that is NOT live.
    // `stock_value` is the only one left in the catalogue.
    expect(keepEligible(["revenue", "revenue", "made_up", "stock_value", "sla_on_time"], ALL)).toEqual([
      "revenue",
      "sla_on_time",
    ]);
  });
  it("is total over garbage: non-strings and non-arrays answer []", () => {
    expect(keepEligible([null, 3, {}], ALL)).toEqual([]);
    expect(keepEligible(undefined, ALL)).toEqual([]);
  });
});

describe("selectBand precedence (user > role > default)", () => {
  it("no pins, no role config → the system default four, in order", () => {
    const r = selectBand({ pins: null, roleConfigs: [], eligible: ALL });
    expect(r).toEqual({ source: "default", ids: [...SYSTEM_DEFAULT_IDS] });
  });

  it("user pins win over the role default (D1)", () => {
    const r = selectBand({
      pins: ["compliance_open"],
      roleConfigs: [{ defaultIds: ["revenue"], lockedIds: [], scopeIds: null }],
      eligible: ALL,
    });
    expect(r.source).toBe("user");
    expect(r.ids).toEqual(["compliance_open"]);
  });

  it("cleared pins ([]) are a CHOICE, not an absence (D2 doctrine)", () => {
    const r = selectBand({ pins: [], roleConfigs: [], eligible: ALL });
    expect(r.source).toBe("user");
    expect(r.ids).toEqual([]);
  });

  it("multi-role merge concatenates by role order, dedupes, caps at four", () => {
    const r = selectBand({
      pins: null,
      roleConfigs: [
        { defaultIds: ["revenue", "compliance_open"], lockedIds: [], scopeIds: null },
        { defaultIds: ["revenue", "files_active", "needs_location", "approvals_awaiting", "journals_unposted"], lockedIds: [], scopeIds: null },
      ],
      eligible: ALL,
    });
    expect(r.source).toBe("role");
    expect(r.ids).toEqual(["revenue", "compliance_open", "files_active", "needs_location"]);
  });

  it("locks lead the band against USER pins — an exec band that reads the same survives a member's rearrangement", () => {
    const r = selectBand({
      pins: ["files_active", "compliance_open", "needs_location", "approvals_awaiting"],
      roleConfigs: [{ defaultIds: ["revenue", "compliance_open"], lockedIds: ["revenue"], scopeIds: null }],
      eligible: ALL,
    });
    expect(r.ids[0]).toBe("revenue");
    expect(r.ids).toHaveLength(4);
    expect(new Set(r.ids)).toEqual(new Set(["revenue", "files_active", "compliance_open", "needs_location"]));
  });

  it("the band NEVER exceeds four — pins of six, caps of four (D2)", () => {
    const r = selectBand({
      pins: [...LIVE_IDS],
      roleConfigs: [],
      eligible: ALL,
    });
    expect(r.ids.length).toBe(MAX_BAND_TILES);
  });

  it("a pin whose grant was REVOKED drops out and the next survives — read-time filter, no migration (D8/§4.2)", () => {
    const revoked = new Set(LIVE_IDS.filter((id) => BY_ID.get(id).module !== "MOD-51"));
    const r = selectBand({ pins: ["revenue", "compliance_open"], roleConfigs: [], eligible: revoked });
    expect(r.ids).toEqual(["compliance_open"]);
  });

  it("eligibility filters the DEFAULT too: a subject that cannot read MOD-51 never sees the revenue fallback", () => {
    const financeless = new Set(LIVE_IDS.filter((id) => !["revenue", "receivables_overdue"].includes(id)));
    const r = selectBand({ pins: null, roleConfigs: [], eligible: financeless });
    expect(r.ids).not.toContain("revenue");
    expect(r.ids).not.toContain("receivables_overdue");
    expect(r.ids.length).toBeGreaterThan(0);
  });

  it("nothing eligible → empty band, no crash", () => {
    const r = selectBand({ pins: null, roleConfigs: [], eligible: new Set() });
    expect(r.ids).toEqual([]);
  });
});

describe("paintBand — the zero policy (D3) and the shrink (D8)", () => {
  it("a resolved 0 paints; a null value is unavailable and drops out, counted", () => {
    const selection = { source: "default", ids: ["revenue", "receivables_overdue"] };
    const band = paintBand(selection, val({ revenue: 0, receivables_overdue: null }));
    expect(band.slots.map((s) => s.id)).toEqual(["revenue"]);
    expect(band.slots[0].value).toBe(0); // asserted zero, not a hidden tile
    expect(band.hidden).toEqual(["receivables_overdue"]);
  });

  it("ratio tiles keep their denominator and measurable flag (§6.4)", () => {
    const band = paintBand({ source: "default", ids: ["sla_on_time", "fleet_utilisation"] }, val({
      sla_on_time: { value: 0, denominator: 0 },
      fleet_utilisation: { value: 3, denominator: 3 },
    }));
    const sla = band.slots.find((s) => s.id === "sla_on_time");
    const fleet = band.slots.find((s) => s.id === "fleet_utilisation");
    expect(sla).toMatchObject({ value: 0, denominator: 0, measurable: false });
    expect(fleet).toMatchObject({ value: 3, denominator: 3, measurable: true });
  });

  it("slots carry the display metadata — the band payload is self-describing (one resolver, no client-side catalog copy)", () => {
    const band = paintBand({ source: "default", ids: ["revenue"] }, val());
    expect(band.slots[0]).toMatchObject({
      id: "revenue",
      unit: "money",
      tone: "orange",
      labelKey: "dash.revenue",
      hintKey: "dash.revenueHint",
      badgeKey: "dash.locked",
    });
  });
});

describe("pickerModel", () => {
  it("offers only what will paint (eligible ∩ live), and counts what it withheld", () => {
    const m = pickerModel({
      eligible: [...ALL],
      available: ["revenue", "compliance_open"],
      locked: [],
      defaultIds: [],
      currentIds: null,
    });
    expect(m.tiles.map((t) => t.id)).toEqual(["revenue", "compliance_open"]);
    expect(m.hiddenTileCount).toBe(ALL.size - 2);
    expect(m.totalLive).toBe(ALL.size);
    expect(m.currentIds).toBeNull();
  });

  it("current pins that fell out of eligibility are filtered from the draft (the band and picker agree)", () => {
    const m = pickerModel({
      eligible: ["revenue", "compliance_open"],
      available: ["revenue", "compliance_open"],
      locked: [],
      defaultIds: ["revenue"],
      currentIds: ["compliance_open", "journals_unposted"], // revoked since pinning
    });
    expect(m.currentIds).toEqual(["compliance_open"]);
  });
});

describe("eligibility — grants and masks (no DB: pure filter)", () => {
  it("a module grant admits exactly its tiles", () => {
    // One grant, every live tile that aggregates over it — MOD-51 now gates
    // two (revenue and dso both read `invoice`), MOD-52 two more. A grant
    // admitting MORE tiles as domains ship is the model working: the tile
    // inherits the right, it never adds one.
    expect(eligibleIds(new Set(["MOD-51"]), new Set()).sort()).toEqual(["dso", "revenue"]);
    expect(eligibleIds(new Set(["MOD-51", "MOD-52"]), new Set()).sort()).toEqual([
      "cash_collected",
      "dso",
      "receivables_overdue",
      "revenue",
    ]);
  });

  it("CEO admits all live tiles; no grants admit none", () => {
    expect(eligibleIds(new Set(), new Set(), { isCeo: true }).sort()).toEqual([...LIVE_IDS].sort());
    expect(eligibleIds(new Set(), new Set())).toEqual([]);
  });

  it("the filter admits LIVE ids only — a hidden tile cannot be eligible into a picker", () => {
    const out = eligibleIds(new Set(CATALOG.map((e) => e.module)), new Set(), { isCeo: true });
    expect(out.sort()).toEqual([...LIVE_IDS].sort());
  });

  it("a masked sensitive field REMOVES the tile, not just its value (§4.3)", () => {
    const finance = new Set(["MOD-46", "MOD-51", "MOD-52"]);
    const withoutMask = eligibleIds(finance, new Set());
    // margin_closed is still hidden in PR-1, so the LIVE answer must be
    // unchanged — which is itself the assertion worth having: today's band
    // cannot regress on a tile it does not paint yet. The mask rule is pinned
    // structurally instead: the entry carries the key, and when its domain PR
    // flips it live, `eligibleIds` drops it on mask — the same filter, so the
    // flip inherits the rule with no new code.
    expect(withoutMask).toEqual(withoutMask.filter((id) => id !== "margin_closed"));
    expect(BY_ID.get("margin_closed").sensitive_field).toBe("dossier.margin");
    // and the filter's mask branch is exercised against a live entry with a
    // forced sensitive field, to pin the mechanism itself:
    const before = BY_ID.get("revenue").sensitive_field;
    BY_ID.get("revenue").sensitive_field = "gl.account";
    try {
      expect(eligibleIds(finance, new Set(["gl.account"]))).not.toContain("revenue");
      expect(eligibleIds(finance, new Set())).toContain("revenue");
    } finally {
      BY_ID.get("revenue").sensitive_field = before;
    }
  });
});
