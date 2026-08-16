/**
 * The hubs and the ribbon describe the same product.
 *
 * THE FAILURE THIS EXISTS TO CATCH is silent and slow: someone adds a tab to a
 * hub, the ribbon's second row is built from `areas.ts`, and the new screen is
 * simply not in the chrome. Nothing throws, nothing looks broken, and the tab
 * is reachable only by typing its URL — until somebody eventually reports that
 * a screen they were told about does not exist. Both lists come from one
 * definition now, and these tests are what keep it that way rather than
 * `hubTabs` being a convention people can route around.
 *
 * It also pins the JOIN to the permission model. The ribbon filters by module
 * key, and a section whose route is not in `screen-registry.json` has no module
 * key to filter on — so it would show for everybody regardless of grants. That
 * is a fail-open, and the registry is the one place the house rules already
 * require a new route to be listed.
 */
import { describe, it, expect } from "vitest";
import {
  AREAS,
  areaForPath,
  areaRoute,
  hubTabs,
  sectionRoute,
  sectionsOf,
} from "./areas";
import { moduleForRoute, SCREENS } from "@/app/screen-registry";

/** Every hub in the app, and the component keys it hands `hubTabs`. Kept as
 *  keys rather than imported components on purpose — importing the real hubs
 *  would pull sixty lazy screens into this test's module graph to compare two
 *  lists of strings. */
const HUB_COMPONENT_KEYS: Record<string, string[]> = {
  "/sales": [
    "leads",
    "quote-requests",
    "opportunities",
    "proposals",
    "meetings",
    "campaigns",
    "success-stories",
  ],
  "/commercial": [
    "quotations",
    "margin-simulation",
    "extra-charge-simulation",
    "pricing-variance",
  ],
  "/procurement": [
    "purchase-requests",
    "purchase-orders",
    "goods-received",
    "supplier-invoices",
  ],
  "/operations": ["files", "milestones", "transit-orders", "delivery-notes"],
  "/wms": [
    "locations",
    "inventory",
    "inbound",
    "outbound",
    "equipment",
    "cycle-counts",
  ],
  "/fleet": [
    "vehicles",
    "compliance",
    "work-orders",
    "dispatch",
    "fuel",
    "drivers",
    "incidents",
  ],
  "/finance": [
    "invoices",
    "proformas",
    "receivables",
    "journals",
    "credit-notes",
    "chart-of-accounts",
    "statements",
    "tax",
    "assets",
    "debt",
  ],
  "/costing": ["costing", "cost-tracking", "cash-requests", "regie"],
  "/hr": [
    "employees",
    "payroll",
    "vacancies",
    "contracts",
    "appraisals",
    "queries",
    "sanctions",
    "attendance",
    "leave",
    "trainings",
    "sops",
    "talent-pool",
  ],
  "/master": [
    "clients",
    "suppliers",
    "corporate-entities",
    "treasury-accounts",
    "currencies",
    "expense-rates",
    "financial-dictionary",
    "tax-jurisdictions",
    "service-types",
  ],
  "/vault": [
    "overview",
    "documents",
    "signatures",
    "verification",
    "compliance-flags",
    "reports",
  ],
  "/security": [
    "overview",
    "users",
    "roles",
    "permissions",
    "capabilities",
    "scopes",
    "field-visibility",
    "sessions",
    "my-security",
  ],
  "/ai-control": ["features", "access", "budget", "usage"],
};

const Stub = () => null;
const stubs = (keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, Stub]));

describe("the ribbon's row B and the hub's tabs are one list", () => {
  it.each(Object.entries(HUB_COMPONENT_KEYS))(
    "%s renders exactly the sections the ribbon offers",
    (basePath, keys) => {
      const tabs = hubTabs(basePath, stubs(keys));
      expect(tabs.map((t) => t.key)).toEqual(
        sectionsOf(basePath).map((s) => s.key),
      );
    },
  );

  /**
   * `hubTabs` drops a section it has no component for rather than throwing —
   * taking a whole area down for a typo would be the worse failure. That makes
   * the drop invisible at runtime, so it has to be visible here.
   */
  it.each(Object.entries(HUB_COMPONENT_KEYS))(
    "%s has a page for every section",
    (basePath, keys) => {
      const missing = sectionsOf(basePath)
        .map((s) => s.key)
        .filter((k) => !keys.includes(k));
      expect(missing).toEqual([]);
    },
  );

  it("drops a section with no page, rather than crashing the area", () => {
    const tabs = hubTabs("/costing", { costing: Stub });
    expect(tabs.map((t) => t.key)).toEqual(["costing"]);
  });
});

describe("every destination can be permission-filtered", () => {
  /**
   * A route the registry does not know has no module key, so the ribbon shows
   * it to everyone. That is the right fallback (hiding a screen because someone
   * forgot a registry entry is worse than showing one the API will refuse) and
   * exactly why it must not become the normal case.
   */
  it("registers every section's route", () => {
    const unregistered = AREAS.flatMap((a) =>
      a.sections
        .map((s) => sectionRoute(a, s))
        .filter((route) => moduleForRoute(route) === undefined),
    );
    expect(unregistered).toEqual([]);
  });

  /**
   * A hub's landing route (`/fleet`) needs no entry of its own — the hub is its
   * sections, and those carry the grants. An area that IS a single screen has
   * no sections to carry anything, so its landing route is the only thing
   * standing between it and being visible to everyone.
   */
  it("registers the landing route of every area that is a single screen", () => {
    const unregistered = AREAS.filter((a) => a.sections.length === 0)
      .map(areaRoute)
      .filter((route) => moduleForRoute(route) === undefined);
    expect(unregistered).toEqual([]);
  });

  /** An area is placed under a workflow verb by its modules' votes, so an area
   *  whose every route is ungated could never be placed at all — it would be
   *  absent from the ribbon rather than visible in it. */
  it("gates at least one route in every area", () => {
    const ungated = AREAS.filter((a) =>
      [areaRoute(a), ...a.sections.map((s) => sectionRoute(a, s))].every(
        (r) => !moduleForRoute(r),
      ),
    );
    expect(ungated.map((a) => a.key)).toEqual([]);
  });

  it("keeps the registry free of duplicate routes, so the lookup is unambiguous", () => {
    const seen = new Set<string>();
    const dupes = SCREENS.map((s) => s.route).filter((r) =>
      seen.has(r) ? true : (seen.add(r), false),
    );
    expect(dupes).toEqual([]);
  });
});

describe("areaForPath", () => {
  it("resolves a section to its own area, not to a shorter prefix", () => {
    expect(areaForPath("/master/clients")?.key).toBe("master");
    expect(areaForPath("/finance/invoices")?.key).toBe("finance");
  });

  it("does not let a bare prefix swallow a different route", () => {
    // `/master` must not match `/my-appearance`; the old menubar's prefix
    // matching had exactly this class of bug.
    expect(areaForPath("/my-appearance")).toBeUndefined();
    expect(areaForPath("/masterclass")).toBeUndefined();
  });

  it("matches the Control Tower only on exactly `/`", () => {
    expect(areaForPath("/")?.key).toBe("tower");
    expect(areaForPath("/fleet")?.key).toBe("fleet");
  });

  it("finds an area through a section routed outside it", () => {
    // Governance's four screens are top-level paths for historical reasons.
    expect(areaForPath("/approvals")?.key).toBe("governance");
  });
});
