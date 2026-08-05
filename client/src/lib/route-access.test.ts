/**
 * "May this user open that URL?" — the predicate every offering surface shares.
 *
 * THE CASE THAT MATTERS IS THE DETAIL PAGE. The registry lookup the ribbon uses
 * is an exact match, which is correct for it (it only ever asks about routes it
 * built from the registry) and silently wrong here: the URL bar produces
 * `/finance/invoices/8f2c…`, an exact lookup finds no entry, "no entry" means
 * ungated, and every detail page in the product becomes a hole in the gate. So
 * the prefix behaviour is not a convenience — it is the reason this function
 * exists rather than a call to `moduleForRoute`.
 *
 * The other three are the ones where being WRONG IN THE STRICT DIRECTION costs
 * more than being wrong in the loose one: an unregistered route, a deliberately
 * ungated one, and a CEO with no grant rows. Hiding a screen because somebody
 * forgot a registry line is a bug nobody would ever think to look for.
 *
 * These run against the REAL `screen-registry.json`, not a fixture. A fixture
 * would pass while the registry said something else, which is the only way this
 * can actually fail in production.
 */
import { describe, it, expect } from "vitest";
import { canOpenRoute, gatingModulesForPath, moduleForPath } from "./route-access";
import { AREAS } from "@/app/layout/areas";
import type { NavAccess } from "./nav-access";

const user = (modules: string[], isCeo = false): NavAccess => ({
  modules,
  groups: [],
  byGroup: {},
  isCeo,
  version: "v",
});

describe("moduleForPath", () => {
  it("resolves a registered screen to its module", () => {
    expect(moduleForPath("/finance/invoices")).toBe("MOD-51");
  });

  it("resolves a DETAIL path under a registered screen", () => {
    expect(moduleForPath("/finance/invoices/8f2c1d40-0000-4000-8000-000000000000")).toBe("MOD-51");
  });

  it("prefers the longest registered prefix", () => {
    // `/finance` and `/finance/journals` are both registered and gate different
    // modules. Matching the shorter one first would hand every Finance screen
    // the hub's grant.
    expect(moduleForPath("/finance/journals")).toBe("MOD-05");
    expect(moduleForPath("/finance/journals/new")).toBe("MOD-05");
  });

  it("matches `/` exactly and never as a prefix", () => {
    // As a prefix it matches the entire application, which would give every
    // route in the product the dashboard's module.
    expect(moduleForPath("/")).toBe("MOD-00A");
    expect(moduleForPath("/fleet")).not.toBe("MOD-00A");
  });

  it("ignores a query string, a hash and a trailing slash", () => {
    expect(moduleForPath("/finance/invoices?tab=draft")).toBe("MOD-51");
    expect(moduleForPath("/finance/invoices#row-3")).toBe("MOD-51");
    expect(moduleForPath("/finance/invoices/")).toBe("MOD-51");
  });

  it("does not let one route prefix-match a sibling that merely starts the same way", () => {
    // `/master` must not swallow `/my-appearance`. The registry has both, and a
    // naive `startsWith` gates a personal preferences screen on master data.
    expect(moduleForPath("/my-appearance")).toBeNull();
  });

  it("says `undefined` for an unregistered path and `null` for an ungated one", () => {
    // Two different statements. The caller treats both as openable, but only
    // one of them is a deliberate decision, and conflating them here would hide
    // a missing registry entry forever.
    expect(moduleForPath("/nothing-here-at-all")).toBeUndefined();
    expect(moduleForPath("/help")).toBeNull();
  });
});

describe("a hub landing page is gated by its sections, not by one module", () => {
  /**
   * THE HOLE THIS CLOSED. `/finance`, `/wms` and eleven more are routed in
   * app.tsx and absent from the registry — so the literal reading is
   * "unregistered, therefore ungated, therefore anyone can open it". Those are
   * precisely the routes ⌘K's curated shortcuts and the launcher tiles point
   * at, which means the two widest offers in the product would both have kept
   * offering Finance to a warehouse role after this whole change.
   */
  it("resolves an unregistered hub to the modules of its sections", () => {
    expect(moduleForPath("/finance")).toBeUndefined();
    const mods = gatingModulesForPath("/finance");
    expect(mods.length).toBeGreaterThan(1);
    expect(mods).toContain("MOD-51");
  });

  it("opens the hub for a user who holds ANY of them", () => {
    // A user with only Journals must still reach Finance — the ribbon already
    // shows them that tab, and a hub they cannot open with a section they can
    // read is a contradiction the user experiences as a bug.
    expect(canOpenRoute(user(["MOD-05"]), "/finance")).toBe(true);
  });

  it("refuses the hub for a user who holds none", () => {
    expect(canOpenRoute(user(["MOD-33", "MOD-35"]), "/finance")).toBe(false);
  });

  it("still gates the sections individually", () => {
    // Reaching the hub is not reaching everything in it.
    expect(canOpenRoute(user(["MOD-05"]), "/finance")).toBe(true);
    expect(canOpenRoute(user(["MOD-05"]), "/finance/invoices")).toBe(false);
    expect(canOpenRoute(user(["MOD-05"]), "/finance/journals")).toBe(true);
  });

  it("applies to every hub, not just the one that was noticed", () => {
    expect(canOpenRoute(user(["MOD-51"]), "/wms")).toBe(false);
    expect(canOpenRoute(user(["MOD-35"]), "/wms")).toBe(true);
  });

  it("leaves NO area landing page ungated by accident", () => {
    // The regression guard for the hole itself, over the real AREAS list rather
    // than the handful spelled out above. An area that resolves to no module is
    // a hub anyone can open, and the way that happens is not malice — it is one
    // new hub whose sections nobody added to the registry, which is the same
    // omission that made all thirteen of them open before this.
    const wideOpen = AREAS.filter((a) => a.basePath && gatingModulesForPath(a.basePath).length === 0).map(
      (a) => a.basePath,
    );
    expect(wideOpen).toEqual([]);
  });
});

describe("canOpenRoute", () => {
  it("allows a granted module", () => {
    expect(canOpenRoute(user(["MOD-51"]), "/finance/invoices")).toBe(true);
  });

  it("refuses one the user does not hold", () => {
    expect(canOpenRoute(user(["MOD-33"]), "/finance/invoices")).toBe(false);
  });

  it("refuses the detail page too, not only the list", () => {
    expect(canOpenRoute(user(["MOD-33"]), "/finance/invoices/8f2c")).toBe(false);
  });

  it("lets a CEO with no grant rows through, because rbac.js does", () => {
    // The shell must agree with the enforcement path. Resolving from grants
    // alone locks a CEO out of an application that permits them everything.
    expect(canOpenRoute(user([], true), "/finance/invoices")).toBe(true);
  });

  it("allows an ungated route to anyone", () => {
    expect(canOpenRoute(user([]), "/help")).toBe(true);
  });

  it("allows an UNREGISTERED route rather than hiding it", () => {
    // Deliberate, and the same call `ribbon-model.ts` makes: offering a screen
    // the API will refuse is recoverable and visible; hiding one because a
    // registry line was forgotten is neither.
    expect(canOpenRoute(user([]), "/some/screen/nobody/registered")).toBe(true);
  });

  it("compares module keys case-insensitively", () => {
    expect(canOpenRoute(user(["mod-51"]), "/finance/invoices")).toBe(true);
  });
});
