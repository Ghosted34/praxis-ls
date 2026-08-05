/**
 * The grouped nav map — data, not markup.
 *
 * WHAT STILL READS THIS, now that the ribbon exists. Two surfaces that are
 * deliberately NOT permission-filtered chrome: the ⌘K command palette, and the
 * `< md` hamburger drawer. Both are complete indexes of the product's areas
 * rather than a view of one user's access, and both are grouped by AREA (the
 * sixteen headings below), not by the six workflow verbs the ribbon partitions
 * on. The ribbon's own map is `areas.ts` + `GET /permissions/mine`.
 *
 * The tiered `TOPBAR` table that used to live here went with the menubar it
 * described — the ribbon's second row reveals progressively by its own table
 * (`REVEAL` in ribbon.tsx), and a list nothing renders is a list nobody
 * maintains.
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

/**
 * Every destination in the product, flattened.
 *
 * `Overview` is a grouping, not a destination, so its four screens appear as
 * themselves; the other fifteen areas are hubs and appear once each. The result
 * is a COMPLETE map — which is the property worth keeping: an index that holds
 * only what did not fit somewhere else makes a user work out which bucket a
 * destination is in, and this one never does.
 */
export function areaEntries(nav: NavGroup[]): NavItem[] {
  return nav.flatMap((g) =>
    g.items.length === 1 ? [{ to: g.items[0].to, label: g.heading }] : g.items,
  );
}
