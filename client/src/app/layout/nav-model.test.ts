/**
 * The grouped nav map, asserted.
 *
 * WHAT THIS PINS NOW. `NAV` no longer drives the desktop menubar — the ribbon
 * does, from the server's taxonomy, and `ribbon.test.tsx` covers that. What
 * still reads this table is the ⌘K palette and the phone drawer, and both are
 * COMPLETE indexes: every area, whether or not it fits somewhere else. The
 * failure this catches is a seventeenth area added to the product and reachable
 * from neither.
 *
 * The old `TOPBAR` tier assertions went with the menubar they described. The
 * ribbon's progressive reveal is its own table and its own tests.
 */
import { describe, expect, it } from "vitest";
import { areaEntries, NAV } from "./nav-model";

describe("NAV", () => {
  it("covers the sixteen top-level areas the audit counted", () => {
    expect(NAV).toHaveLength(16);
  });

  it("has no duplicate headings or destinations", () => {
    expect(new Set(NAV.map((g) => g.heading)).size).toBe(NAV.length);
    const tos = NAV.flatMap((g) => g.items.map((i) => i.to));
    expect(new Set(tos).size).toBe(tos.length);
  });

  it("gives every group at least one destination", () => {
    NAV.forEach((g) => expect(g.items.length).toBeGreaterThan(0));
  });
});

describe("areaEntries", () => {
  it("reaches EVERY area, so the index is complete rather than an overflow bin", () => {
    const reachable = new Set(areaEntries(NAV).map((e) => e.to));
    NAV.forEach((g) => {
      const anyReachable = g.items.some((i) => reachable.has(i.to));
      expect(
        anyReachable,
        `${g.heading} is in no index — neither ⌘K nor the drawer lists it`,
      ).toBe(true);
    });
  });

  it("lists a grouping's children rather than the grouping itself", () => {
    // "Overview" is not a destination; Control Tower, My workspace, Support and
    // God mode are.
    const labels = areaEntries(NAV).map((e) => e.label);
    expect(labels).not.toContain("Overview");
    expect(labels).toContain("Control Tower");
    expect(labels).toContain("My workspace");
  });

  it("keeps a hub to one entry", () => {
    const finance = areaEntries(NAV).filter((e) => e.to === "/finance");
    expect(finance).toHaveLength(1);
  });

  it("drops an area the tenant cannot see", () => {
    const withoutFleet = NAV.filter((g) => g.heading !== "Fleet");
    expect(areaEntries(withoutFleet).some((e) => e.to === "/fleet")).toBe(
      false,
    );
  });
});
