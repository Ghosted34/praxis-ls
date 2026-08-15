/**
 * The tower model's four rules, tested against real areas.
 *
 *   1. NULL is a first login and RESOLVES to the default set, filtered by
 *      what this user can reach — so a warehouse-only role sees a shorter
 *      tower rather than a broken one.
 *   2. [] is a deliberate empty, and MUST NOT fall back to defaults. Same
 *      distinction as the rail; collapsing them makes an empty grid
 *      inexpressible.
 *   3. A stored key whose area is no longer visible is DROPPED, not left
 *      dead. A revoked grant should take the tile away, not leave one that
 *      403s.
 *   4. `previewSections` reflects the RIBBON's filter, not the raw AREAS
 *      constant — a section the user cannot read is not offered as a deep
 *      link from the launcher.
 */
import { describe, expect, it } from "vitest";
import type { NavAccess } from "@/lib/nav-access";
import { buildRibbon } from "@/app/layout/ribbon-model";
import {
  DEFAULT_TOWER_PINS,
  MAX_TOWER_PINS,
  pinnableTowerAreas,
  previewSections,
  resolveTowerPins,
  unpinnedTowerAreas,
} from "./tower-model";

/** A permissions payload in the endpoint's real shape. */
function grant(byGroup: Record<string, string[]>): NavAccess {
  const modules = Object.values(byGroup).flat().sort();
  return {
    modules,
    groups: Object.keys(byGroup),
    byGroup,
    isCeo: false,
    version: modules.join("|").slice(0, 12),
  };
}

const CEO = grant({
  monitor: ["MOD-00A", "MOD-64", "MOD-74"],
  engage: [
    "MOD-20",
    "MOD-21",
    "MOD-22",
    "MOD-23",
    "MOD-24",
    "MOD-26",
    "MOD-27",
    "MOD-28",
    "MOD-60",
    "MOD-61",
    "MOD-62",
  ],
  fulfill: [
    "MOD-29",
    "MOD-30",
    "MOD-31",
    "MOD-32",
    "MOD-33",
    "MOD-34",
    "MOD-35",
    "MOD-36",
    "MOD-37",
    "MOD-38",
    "MOD-39",
    "MOD-40",
    "MOD-41",
    "MOD-42",
    "MOD-43",
    "MOD-44",
    "MOD-45",
  ],
  transact: [
    "MOD-51",
    "MOD-52",
    "MOD-53",
    "MOD-54",
    "MOD-56",
    "MOD-58",
    "MOD-59",
    "MOD-46",
    "MOD-47",
    "MOD-49",
  ],
  empower: [
    "MOD-02",
    "MOD-11",
    "MOD-12",
    "MOD-13",
    "MOD-14",
    "MOD-15",
    "MOD-16",
    "MOD-17",
    "MOD-18",
    "MOD-19",
    "MOD-71",
  ],
  configure: [
    "MOD-01",
    "MOD-03",
    "MOD-04",
    "MOD-05",
    "MOD-07",
    "MOD-08",
    "MOD-09",
    "MOD-10",
    "MOD-63",
    "MOD-65",
    "MOD-66",
    "MOD-67",
    "MOD-68",
    "MOD-70",
    "MOD-75",
    "MOD-00B",
  ],
});

const WAREHOUSE_ONLY = grant({
  fulfill: ["MOD-33", "MOD-34", "MOD-35", "MOD-36", "MOD-37", "MOD-38"],
});

describe("tower-model.resolveTowerPins", () => {
  it("returns the default eleven for a null preference", () => {
    const pins = resolveTowerPins(null, buildRibbon(CEO));
    expect(pins.length).toBe(DEFAULT_TOWER_PINS.length);
    expect(pins.map((a) => a.key)).toEqual(DEFAULT_TOWER_PINS);
  });

  it("returns an empty list for a deliberately cleared preference", () => {
    const pins = resolveTowerPins([], buildRibbon(CEO));
    expect(pins).toEqual([]);
  });

  it("drops a stored key whose area the user can no longer see", () => {
    // Warehouse-only cannot see 'finance'; a stored pin for it must vanish
    // rather than render an unreachable tile.
    const pins = resolveTowerPins(
      ["wms", "finance"],
      buildRibbon(WAREHOUSE_ONLY),
    );
    expect(pins.map((a) => a.key)).toEqual(["wms"]);
  });

  it("respects the MAX_TOWER_PINS cap on the way out", () => {
    // A stored list of 20 keys — a client that ignored the cap — must not
    // spill into a fifteen-tile grid.
    const inflated = Array.from(
      { length: 20 },
      (_, i) => DEFAULT_TOWER_PINS[i % DEFAULT_TOWER_PINS.length],
    );
    const pins = resolveTowerPins(inflated, buildRibbon(CEO));
    expect(pins.length).toBeLessThanOrEqual(MAX_TOWER_PINS);
  });

  it("falls through to any visible area rather than emptying on a role with no defaults", () => {
    // A hypothetical role that can only see AI Control (no default of ours).
    const ai = grant({ configure: ["MOD-70"] });
    const pins = resolveTowerPins(null, buildRibbon(ai));
    // Some tile makes it onto the tower — an empty starter grid teaches
    // nobody that pins are a thing.
    expect(pins.length).toBeGreaterThan(0);
  });
});

describe("tower-model.pinnableTowerAreas", () => {
  it("does not offer the Control Tower itself as a pinnable module", () => {
    const areas = pinnableTowerAreas(buildRibbon(CEO));
    expect(areas.map((a) => a.key)).not.toContain("tower");
  });

  it("does not offer Support & feedback — not a module in this sense", () => {
    const areas = pinnableTowerAreas(buildRibbon(CEO));
    expect(areas.map((a) => a.key)).not.toContain("support");
  });
});

describe("tower-model.unpinnedTowerAreas", () => {
  it("is the complement of what is pinned, in ribbon order", () => {
    const families = buildRibbon(CEO);
    const pinned = resolveTowerPins(null, families);
    const rest = unpinnedTowerAreas(pinned, families);
    const pinnedKeys = new Set(pinned.map((a) => a.key));
    for (const a of rest) expect(pinnedKeys.has(a.key)).toBe(false);
    // Together they cover every pinnable area exactly once.
    expect(pinned.length + rest.length).toBe(
      pinnableTowerAreas(families).length,
    );
  });
});

describe("tower-model.previewSections", () => {
  it("returns the first four sub-nav labels for an area the ribbon shows", () => {
    const families = buildRibbon(CEO);
    const operations = pinnableTowerAreas(families).find(
      (a) => a.key === "operations",
    )!;
    const preview = previewSections(operations, families);
    expect(preview.length).toBeLessThanOrEqual(4);
    // Milestones must resolve to the routed deep link, not the raw key.
    const milestones = preview.find((s) => s.key === "milestones");
    expect(milestones?.to).toBe("/operations/milestones");
    expect(milestones?.label).toBe("Milestones");
  });

  it("returns nothing for an area not on the ribbon at all", () => {
    // The warehouse-only role does not see any area but WMS, so previewing
    // Operations against its ribbon returns [] — the launcher then renders
    // the tile without a subtitle strip rather than with three 403 links.
    const families = buildRibbon(WAREHOUSE_ONLY);
    const wms = pinnableTowerAreas(families).find((a) => a.key === "wms")!;
    // Sanity — the reachable module does have sections.
    expect(previewSections(wms, families).length).toBeGreaterThan(0);
    // An unreachable module is not in the pinnable set at all, so the
    // preview is empty by definition — construct it manually to prove the
    // guard rather than by absence.
    const stubArea = {
      key: "operations",
      label: "Operations",
      basePath: "/operations",
      sections: [],
    };
    expect(previewSections(stubArea, families)).toEqual([]);
  });
});
