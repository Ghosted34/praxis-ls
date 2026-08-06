/**
 * The two decisions `ribbon-model.ts` makes that nothing else can check.
 *
 * 1. WHICH FAMILY AN AREA LANDS IN. Several areas straddle verbs at the module
 *    level, so the placement is a vote — and a vote has a tie-break, an
 *    aggregation unit, and a failure mode. Getting it wrong does not throw; it
 *    files the Vault under Monitor and nobody notices until a user cannot find
 *    their documents.
 *
 * 2. THAT EVERY AREA HAS ITS OWN GLYPH. The icon rail is icons ONLY, with the
 *    label behind a hover. Two areas drawn the same are two rail entries a user
 *    cannot tell apart without pointing at each in turn — and the first version
 *    of this shipped Control Tower and My workspace both on `TowerIcon`, with
 *    God mode, AI Control and Settings all on `SettingsIcon`. Four of those five
 *    are in the rail's default reach. It is invisible to every other test in the
 *    suite, because an icon has no accessible name of its own.
 */
import { describe, it, expect } from "vitest";
import { AREAS } from "./areas";
import { buildRibbon, iconForArea, locate } from "./ribbon-model";
import type { NavAccess } from "@/lib/nav-access";

function grant(byGroup: Record<string, string[]>): NavAccess {
  return {
    modules: Object.values(byGroup).flat().sort(),
    groups: Object.keys(byGroup),
    byGroup,
    isCeo: false,
    version: "test",
  };
}

const ALL = grant({
  monitor: ["MOD-00A", "MOD-64", "MOD-74"],
  engage: ["MOD-20", "MOD-21", "MOD-22", "MOD-23", "MOD-24", "MOD-26", "MOD-27", "MOD-28", "MOD-60", "MOD-61", "MOD-62"],
  fulfill: ["MOD-29", "MOD-30", "MOD-31", "MOD-32", "MOD-33", "MOD-34", "MOD-35", "MOD-36", "MOD-37", "MOD-38", "MOD-39", "MOD-40", "MOD-41", "MOD-42", "MOD-43", "MOD-44", "MOD-45"],
  transact: ["MOD-46", "MOD-47", "MOD-49", "MOD-51", "MOD-52", "MOD-53", "MOD-54", "MOD-56", "MOD-58", "MOD-59"],
  empower: ["MOD-02", "MOD-11", "MOD-12", "MOD-13", "MOD-14", "MOD-15", "MOD-16", "MOD-17", "MOD-18", "MOD-19", "MOD-71"],
  configure: ["MOD-01", "MOD-03", "MOD-04", "MOD-05", "MOD-07", "MOD-08", "MOD-09", "MOD-10", "MOD-63", "MOD-65", "MOD-66", "MOD-67", "MOD-68", "MOD-70", "MOD-75", "MOD-00B"],
});

/** verb → the area keys under it, for a user who can see everything. */
function placement() {
  const out: Record<string, string[]> = {};
  for (const f of buildRibbon(ALL)) out[f.key] = f.areas.map((a) => a.area.key);
  return out;
}

describe("an area lands under exactly one verb", () => {
  it("puts every area somewhere, and only once", () => {
    const placed = Object.values(placement()).flat();
    expect(new Set(placed).size).toBe(placed.length);
    // Every area in the map is reachable for a user who can see everything.
    expect(new Set(placed)).toEqual(new Set(AREAS.map((a) => a.key)));
  });

  it("files each area where a person would look for it", () => {
    expect(placement()).toEqual({
      // `ai` is the assistant's workspace, gated on MOD-00A like the Control
      // Tower — so it votes `monitor` and files under Overview. Its admin
      // counterpart, `ai-control` (MOD-67), stays in `configure`. The split is
      // deliberate: use the assistant here, govern it there.
      monitor: ["tower", "workspace", "ai", "comms", "support"],
      engage: ["sales", "commercial", "procurement"],
      fulfill: ["operations", "wms", "fleet"],
      transact: ["finance", "costing"],
      empower: ["hr"],
      configure: ["master", "vault", "security", "governance", "ai-control", "settings", "godmode"],
    });
  });

  /**
   * THE CASE THAT DECIDED THE AGGREGATION UNIT. The Vault's overview, documents
   * and signatures are all gated on MOD-64 — one module, three screens — which
   * the catalogue files under `monitor` as Smart Comms. Verification, compliance
   * flags and reports are MOD-66/65/63, all `configure`. Counting SCREENS makes
   * that 3–3 and the tie hands the whole Vault to Monitor. Counting MODULES
   * makes it 1–3 and the Vault stays where a document vault belongs.
   */
  it("counts modules rather than screens, so one module cannot outvote three", () => {
    expect(placement().configure).toContain("vault");
    expect(placement().monitor).not.toContain("vault");
  });

  /** Finance keeps its Tax center (MOD-07) and Journals (MOD-05) even though
   *  both are `configure` modules — an area shows everything you can read once
   *  it is placed, or a hub would open missing two of its ten tabs. */
  it("keeps a section whose own module sits under a different verb", () => {
    const finance = buildRibbon(ALL)
      .find((f) => f.key === "transact")!
      .areas.find((a) => a.area.key === "finance")!;
    expect(finance.sections.map((s) => s.key)).toContain("tax");
    expect(finance.sections.map((s) => s.key)).toContain("journals");
  });

  it("drops a family whose modules resolve to no screen in this client", () => {
    const out = buildRibbon(grant({ fulfill: ["MOD-29"], empower: ["MOD-999"] }));
    expect(out.map((f) => f.key)).toEqual(["fulfill"]);
  });

  it("returns nothing for a user with nothing", () => {
    expect(buildRibbon(grant({}))).toEqual([]);
  });
});

describe("every area is drawn differently", () => {
  it("gives no two areas the same glyph", () => {
    const byGlyph = new Map<unknown, string[]>();
    for (const area of AREAS) {
      const icon = iconForArea(area.label);
      byGlyph.set(icon, [...(byGlyph.get(icon) ?? []), area.label]);
    }
    const collisions = [...byGlyph.values()].filter((labels) => labels.length > 1);
    expect(collisions, `areas sharing one icon: ${JSON.stringify(collisions)}`).toEqual([]);
  });
});

describe("locate", () => {
  const families = buildRibbon(ALL);

  it("resolves a section to its area and that area's family", () => {
    const hit = locate(families, "/finance/invoices");
    expect(hit.family?.key).toBe("transact");
    expect(hit.area?.area.key).toBe("finance");
  });

  it("prefers the longest match, not the first", () => {
    expect(locate(families, "/master/clients").area?.area.key).toBe("master");
  });

  it("matches the Control Tower only on exactly `/`", () => {
    expect(locate(families, "/").area?.area.key).toBe("tower");
    expect(locate(families, "/wms").area?.area.key).toBe("wms");
  });

  it("returns nothing for a screen that is not in the ribbon", () => {
    // My appearance, a document viewer. The ribbon keeps showing the family you
    // last chose rather than snapping back to the first one.
    expect(locate(families, "/my-appearance").family).toBeUndefined();
  });
});
