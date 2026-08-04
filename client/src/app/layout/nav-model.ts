/**
 * The navigation map — data, not markup.
 *
 * Lifted out of `app-shell.tsx` in Phase 3 so the F9 fix has something to assert
 * against. The claim being made is "every one of the sixteen top-level areas is
 * reachable on desktop without opening an overlay", and that is a property of
 * this table plus `areaEntries` below; a test can pin it, which it could not
 * while the list was interleaved with 26 inline SVGs and a Radix menu.
 *
 * Mirrors the target IA map (doc/FE_IA_HANDOFF.md).
 */
export type NavItem = { to: string; label: string };
export type NavGroup = { heading: string; items: NavItem[]; prefix?: string };

export const NAV: NavGroup[] = [
  {
    heading: "Overview",
    prefix: "/",
    items: [
      { to: "/", label: "Control Tower" },
      { to: "/workspace", label: "My workspace" },
      { to: "/support", label: "Support & feedback" },
      { to: "/godmode", label: "God mode" },
    ],
  },
  { heading: "Commercial", prefix: "/commercial", items: [{ to: "/commercial", label: "Commercial" }] },
  { heading: "Sales & CRM", prefix: "/sales", items: [{ to: "/sales", label: "Sales & CRM" }] },
  { heading: "Operations", prefix: "/operations", items: [{ to: "/operations", label: "Operations" }] },
  { heading: "Procurement", prefix: "/procurement", items: [{ to: "/procurement", label: "Procurement" }] },
  { heading: "Costing", prefix: "/costing", items: [{ to: "/costing", label: "Costing" }] },
  { heading: "Finance", prefix: "/finance", items: [{ to: "/finance", label: "Finance" }] },
  { heading: "Warehouse", prefix: "/wms", items: [{ to: "/wms", label: "Warehouse" }] },
  { heading: "Fleet", prefix: "/fleet", items: [{ to: "/fleet", label: "Fleet" }] },
  { heading: "People & HR", prefix: "/hr", items: [{ to: "/hr", label: "People & HR" }] },
  { heading: "Master data", prefix: "/master", items: [{ to: "/master", label: "Master data" }] },
  { heading: "Vault", prefix: "/vault", items: [{ to: "/vault", label: "Vault & compliance" }] },
  { heading: "Comms", prefix: "/comms", items: [{ to: "/comms", label: "Smart Comms" }] },
  { heading: "Security & Access", prefix: "/security", items: [{ to: "/security", label: "Security & access" }] },
  { heading: "Governance", prefix: "/governance", items: [{ to: "/governance", label: "Governance" }] },
  { heading: "Settings & Admin", prefix: "/settings", items: [{ to: "/settings", label: "Settings & admin" }] },
];

/** Viewport tiers, narrowest first. */
export type Tier = "md" | "lg" | "xl" | "2xl";

/**
 * Areas surfaced inline in the top bar, and the width each one earns.
 *
 * This is the F9 fix in one table. The old list was a flat four; the other
 * twelve areas were drawer-only at EVERY width, including 2560px — so desktop
 * users paid two clicks and a full-screen scrim to reach three quarters of the
 * product. Ordered by how often an operator uses the area, so a narrower window
 * loses the least-used one first rather than an arbitrary one.
 */
export const TOPBAR: { heading: string; from: Tier }[] = [
  { heading: "Overview", from: "md" },
  { heading: "Operations", from: "md" },
  { heading: "Finance", from: "md" },
  { heading: "Fleet", from: "md" },
  { heading: "Warehouse", from: "lg" },
  { heading: "Sales & CRM", from: "xl" },
  { heading: "Commercial", from: "xl" },
  { heading: "Procurement", from: "2xl" },
  { heading: "Costing", from: "2xl" },
  { heading: "People & HR", from: "2xl" },
];

/** Tailwind cannot see a class name assembled at runtime, so the four variants
 *  are spelled out rather than templated. */
export const TIER_CLASS: Record<Tier, string> = {
  md: "hidden md:inline-flex",
  lg: "hidden lg:inline-flex",
  xl: "hidden xl:inline-flex",
  "2xl": "hidden 2xl:inline-flex",
};

/**
 * Every destination in the product, flattened for the "All areas" menu.
 *
 * `Overview` is a grouping, not a destination, so its four screens appear as
 * themselves; the other fifteen areas are hubs and appear once each. The menu
 * lists ALL of them, including the ones already inline — an overflow bin that
 * holds only what did not fit makes the user work out which bucket a
 * destination is in, and a complete map does not.
 */
export function areaEntries(nav: NavGroup[]): NavItem[] {
  return nav.flatMap((g) =>
    g.items.length === 1 ? [{ to: g.items[0].to, label: g.heading }] : g.items,
  );
}
