/**
 * The F9 claim, asserted.
 *
 * "Desktop navigation reaching all 16 areas without an overlay" is the Phase 3
 * deliverable. It is a property of the nav table, so it can be a test rather
 * than a screenshot — and this is the one that fails if someone adds a
 * seventeenth area and forgets that it now exists only behind a scrim.
 */
import { describe, expect, it } from "vitest";
import { areaEntries, NAV, TIER_CLASS, TOPBAR } from "./nav-model";

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
  it("reaches EVERY area without opening the mobile drawer", () => {
    // This is the finding: twelve of sixteen areas used to be drawer-only at
    // every viewport width, 2560px included.
    const reachable = new Set(areaEntries(NAV).map((e) => e.to));
    NAV.forEach((g) => {
      const anyReachable = g.items.some((i) => reachable.has(i.to));
      expect(anyReachable, `${g.heading} is unreachable from the desktop menubar`).toBe(true);
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
    expect(areaEntries(withoutFleet).some((e) => e.to === "/fleet")).toBe(false);
  });
});

describe("TOPBAR", () => {
  it("names only real areas", () => {
    const headings = new Set(NAV.map((g) => g.heading));
    TOPBAR.forEach((t) => expect(headings.has(t.heading), `${t.heading} is not a NAV group`).toBe(true));
  });

  it("reveals areas progressively, never hiding one that a narrower tier showed", () => {
    const order: Record<string, number> = { md: 0, lg: 1, xl: 2, "2xl": 3 };
    const tiers = TOPBAR.map((t) => order[t.from]);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
  });

  it("keeps the md row short enough to sit beside the brand and the tools", () => {
    expect(TOPBAR.filter((t) => t.from === "md")).toHaveLength(4);
  });

  it("uses the real desktop tiers the app never had — xl and 2xl", () => {
    // F2: 216 `sm:` prefixes, zero `xl:`/`2xl:`. The nav is one of the places
    // that gap was most visible.
    const used = new Set(TOPBAR.map((t) => t.from));
    expect(used.has("xl")).toBe(true);
    expect(used.has("2xl")).toBe(true);
  });

  it("has a spelled-out class per tier, so Tailwind can see them", () => {
    TOPBAR.forEach((t) => expect(TIER_CLASS[t.from]).toMatch(/^hidden \S+:inline-flex$/));
  });
});
