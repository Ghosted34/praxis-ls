/**
 * The band model — formatting, slot arithmetic, and the persist translation.
 *
 * WHY these are worth their own file even though the strip tests paint the
 * component: the functions here are the rules the UI cannot be trusted to
 * re-derive. A pair rendering "0 / 0 vehicles" as "0" (dropping the
 * denominator) misstates the fleet size; a locked tile removable in one place
 * and not another re-breaks the D7 answer; and `draftToPins` collapsing the
 * null-vs-[] pair would make "clear my band" impossible or "restore default"
 * permanently sticky. Each test is the falsifying case for one of those, and
 * the formatting half doubles as the guard on the guide's §6.4 measurable rule.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_BAND_TILES,
  draftAdd,
  draftDirty,
  draftInitial,
  draftMove,
  draftRemove,
  draftToPins,
  formatBandValue,
  type BandSlot,
} from "./kpi-model";

const id = (over: Partial<BandSlot> = {}): BandSlot => ({
  id: "revenue",
  domain: "money",
  unit: "money",
  module: "MOD-51",
  status: "live",
  tone: "orange",
  icon: "revenue",
  labelKey: "dash.revenue",
  hintKey: "dash.revenueHint",
  badgeKey: "dash.locked",
  drillTo: "/finance/invoices",
  value: 0,
  denominator: null,
  measurable: true,
  ...over,
});

const t = (k: string) =>
  ({ "dash.unitVehicles": "vehicles", "dash.unitDays": "days" })[k] ?? k;

describe("formatBandValue", () => {
  it("money: compact millions, and 0 renders as 0.0 — never hidden", () => {
    expect(formatBandValue(id({ value: 226_000_000 }), "XAF", t)).toEqual({
      text: "226.0",
      unit: "M XAF",
    });
    expect(formatBandValue(id({ value: 0 }), "XAF", t)).toEqual({
      text: "0.0",
      unit: "M XAF",
    });
  });

  it("pct rounds and keeps the percent sign at zero", () => {
    expect(formatBandValue(id({ unit: "pct", value: 96.4 }), "XAF", t).text).toBe("96");
    expect(formatBandValue(id({ unit: "pct", value: 0, denominator: 0, measurable: false }), "XAF", t).text).toBe("0");
  });

  it("pair renders n / m with the noun — an empty fleet says so in full", () => {
    expect(
      formatBandValue(
        id({ id: "fleet_utilisation", unit: "pair", value: 0, denominator: 0, measurable: false }),
        "XAF",
        t,
      ),
    ).toEqual({ text: "0", unit: "/ 0 vehicles" });
    expect(formatBandValue(id({ id: "fleet_utilisation", unit: "pair", value: 3, denominator: 3 }), "XAF", t)).toEqual({
      text: "3",
      unit: "/ 3 vehicles",
    });
  });

  it("count has no unit, days carry the word", () => {
    expect(formatBandValue(id({ unit: "count", value: 7 }), "XAF", t)).toEqual({ text: "7", unit: null });
    expect(formatBandValue(id({ unit: "days", value: 4 }), "XAF", t)).toEqual({ text: "4", unit: "days" });
  });
});

describe("slot arithmetic", () => {
  it("adds to the first free slot and refuses past four (MAX is the layout promise)", () => {
    let d: string[] = [];
    d = draftAdd(d, "revenue");
    d = draftAdd(d, "revenue"); // dup no-ops
    expect(d).toEqual(["revenue"]);
    d = draftAdd(d, "sla_on_time");
    d = draftAdd(d, "files_active");
    d = draftAdd(d, "needs_location");
    d = draftAdd(d, "compliance_open");
    expect(d).toHaveLength(MAX_BAND_TILES);
    expect(draftAdd(d, "approvals_awaiting")).toEqual(d); // full band is full
  });

  it("removes are refused for locked tiles, reorders are allowed for them", () => {
    const d = ["revenue", "files_active"];
    expect(draftRemove(d, "revenue", ["revenue"])).toEqual(d);
    expect(draftRemove(d, "revenue", [])).toEqual(["files_active"]);
    expect(draftMove(d, "revenue", 1)).toEqual(["files_active", "revenue"]);
    // locked can move (the ROLE owns its presence, the user owns its place)
    expect(draftMove(["revenue", "files_active"], "revenue", 1)).toEqual(["files_active", "revenue"]);
    expect(draftMove(["a"], "a", 1)).toEqual(["a"]); // walls are walls
  });
});

describe("draft → persist translation", () => {
  it("a draft that re-states the role default persists as NULL (follow, don't freeze)", () => {
    expect(draftToPins(["revenue", "sla_on_time"], ["revenue", "sla_on_time"])).toBeNull();
  });

  it("a draft ORDER different from the default is a real choice", () => {
    expect(draftToPins(["sla_on_time", "revenue"], ["revenue", "sla_on_time"])).toEqual([
      "sla_on_time",
      "revenue",
    ]);
  });

  it("an empty draft with no role default persists as [] — deliberately cleared, never a silent fall-through", () => {
    expect(draftToPins([], [])).toEqual([]);
  });

  it("draftInitial prefers the user's pins, then the role default, then the painted band", () => {
    expect(draftInitial({ currentIds: ["b", "a"], roleDefaultIds: ["c"] }, ["x"])).toEqual(["b", "a"]);
    expect(draftInitial({ currentIds: null, roleDefaultIds: ["c", "d"] }, ["x"])).toEqual(["c", "d"]);
    expect(draftInitial({ currentIds: null, roleDefaultIds: [] }, ["x", "y"])).toEqual(["x", "y"]);
  });

  it("draftDirty sees order changes as well as content changes", () => {
    expect(draftDirty(["a", "b"], ["a", "b"])).toBe(false);
    expect(draftDirty(["b", "a"], ["a", "b"])).toBe(true);
    expect(draftDirty(["a"], ["a", "b"])).toBe(true);
  });
});
