/**
 * The app's areas and their sections — one definition, two consumers.
 *
 * WHAT PROBLEM THIS SOLVES. Every area in this product is a hub with a tab
 * strip: `/finance/:section`, `/fleet/:section`, and so on. The ribbon's second
 * row shows those same destinations, because that is the point of a ribbon —
 * the navigation belongs in the chrome, not stacked a third time above the
 * data. If the two were written out separately they would drift, and the drift
 * would be invisible: a tab added to a hub simply would not appear in the
 * ribbon, and nobody would notice until a user could not find a screen they had
 * been told existed.
 *
 * So the section list lives here, as data. `hubTabs()` in `tabbed-hub.tsx`
 * zips it with the page components to build a hub's tabs; the ribbon reads it
 * directly. `areas.test.ts` pins that the two agree.
 *
 * COMPONENTS ARE DELIBERATELY ABSENT. Every screen in this app is a lazy route
 * (app.tsx), and the shell is eager — so a map that named components would drag
 * all sixty screens into the shell's chunk and undo the route splitting. Labels
 * and keys are all the chrome needs.
 *
 * THE TAXONOMY IS NOT HERE, AND MUST NOT BE. Which of the six workflow verbs an
 * area belongs to is `platform.module_catalogue.group_key`, delivered per
 * request by `GET /permissions/mine`. This file says what exists and what it is
 * called; the server says who may see it and where it sits. The join between
 * the two is by module key, which comes from `screen-registry.json` — the file
 * the house rules already require a new route to be registered in.
 */

import type * as React from "react";

/** One destination inside an area. `to` defaults to `<basePath>/<key>`. */
export type AreaSection = {
  key: string;
  label: string;
  /** For sections that are not routed under their area — Governance's are all
   *  top-level paths (`/approvals`, `/audit`), which is historical and not
   *  worth a redirect table to hide. */
  to?: string;
};

export type Area = {
  /** Stable id. Used as a rail-pin key, so renaming one un-pins it. */
  key: string;
  label: string;
  /** Route prefix. `""` for areas that ARE a single screen (Control Tower). */
  basePath: string;
  /** Where the area's own landing page is. Defaults to `basePath`. */
  to?: string;
  sections: AreaSection[];
};

/**
 * Ordered, and the order is what a user sees left to right in the ribbon's
 * second row. Areas within a family keep the sequence the product reads in
 * (sell → move → bill), not alphabetical.
 */
export const AREAS: Area[] = [
  { key: "tower", label: "Control Tower", basePath: "", to: "/", sections: [] },
  {
    key: "workspace",
    label: "My workspace",
    basePath: "/workspace",
    sections: [],
  },
  /**
   * Praxis AI — the assistant's workspace.
   *
   * IT SITS IN OVERVIEW, and the placement is load-bearing rather than tidy.
   * `buildRibbon` derives an area's family by VOTE of its screens' `module_key`
   * (ribbon-model.ts), and drops any area whose routes are ungated entirely —
   * so where this lands is decided by the registry entry for `/ai`, which gates
   * it on MOD-00A, the same module as the Control Tower and My workspace. That
   * votes `monitor`, i.e. Overview.
   *
   * WHY NOT BESIDE AI CONTROL. AI Control is gated on MOD-67 and lands in
   * Configure, which is right for it: it is where an administrator sets the
   * budget, the grants and the feature flags. This is where a user ASKS the
   * assistant something. Filing the two together would put a daily tool behind
   * an admin heading.
   *
   * WHY NOT INSIDE A MODULE FAMILY. It reads Finance and Operations and
   * Procurement. Under any one of them the label would misstate its scope.
   */
  { key: "ai", label: "Praxis AI", basePath: "/ai", sections: [] },
  { key: "comms", label: "Smart Comms", basePath: "/comms", sections: [] },
  {
    key: "support",
    label: "Support & feedback",
    basePath: "/support",
    sections: [],
  },

  {
    key: "sales",
    label: "Sales & CRM",
    basePath: "/sales",
    sections: [
      { key: "leads", label: "Leads & intake" },
      { key: "enquiries", label: "Contact enquiries" },
      { key: "quote-requests", label: "Quote requests" },
      { key: "opportunities", label: "Opportunities" },
      { key: "proposals", label: "Proposals" },
      { key: "company-profile", label: "Company profile" },
      { key: "meetings", label: "Meetings" },
      { key: "campaigns", label: "Campaigns" },
      { key: "partnerships", label: "Partnerships" },
      { key: "success-stories", label: "Success stories" },
    ],
  },
  {
    key: "commercial",
    label: "Commercial",
    basePath: "/commercial",
    sections: [
      { key: "quotations", label: "Quotations" },
      { key: "margin-simulation", label: "Margin simulation" },
      { key: "extra-charge-simulation", label: "Extra-charge simulation" },
      { key: "pricing-variance", label: "Pricing variance" },
    ],
  },
  {
    key: "procurement",
    label: "Procurement",
    basePath: "/procurement",
    sections: [
      { key: "purchase-requests", label: "Requests" },
      { key: "purchase-orders", label: "Purchase orders" },
      { key: "goods-received", label: "Goods received" },
      { key: "supplier-invoices", label: "Supplier invoices" },
    ],
  },

  {
    key: "operations",
    label: "Operations",
    basePath: "/operations",
    sections: [
      { key: "files", label: "Files" },
      { key: "milestones", label: "Milestones" },
      { key: "transit-orders", label: "Transit orders" },
      { key: "delivery-notes", label: "Delivery notes" },
      // Service types moved to Master Data — the taxonomy IS master data
      // (0310_operations.sql:7). Backend module stays under operations and
      // rides MOD-29; only the UI regrouped.
    ],
  },
  {
    key: "wms",
    label: "Warehouse",
    basePath: "/wms",
    sections: [
      { key: "locations", label: "Locations" },
      { key: "inventory", label: "Inventory" },
      { key: "inbound", label: "Inbound / GRN" },
      { key: "outbound", label: "Outbound" },
      { key: "equipment", label: "Equipment" },
      { key: "cycle-counts", label: "Cycle counts" },
    ],
  },
  {
    key: "fleet",
    label: "Fleet",
    basePath: "/fleet",
    sections: [
      { key: "vehicles", label: "Vehicles" },
      { key: "compliance", label: "Compliance" },
      { key: "work-orders", label: "Work orders" },
      { key: "dispatch", label: "Dispatch" },
      { key: "fuel", label: "Fuel log" },
      { key: "drivers", label: "Drivers" },
      { key: "incidents", label: "Incidents" },
    ],
  },

  {
    key: "finance",
    label: "Finance",
    basePath: "/finance",
    sections: [
      { key: "invoices", label: "Invoices" },
      { key: "proformas", label: "Proforma & advances" },
      { key: "receivables", label: "Receivables" },
      { key: "credit-notes", label: "Credit notes" },
      { key: "journals", label: "Journals" },
      { key: "chart-of-accounts", label: "Chart of accounts" },
      { key: "statements", label: "Statements" },
      { key: "tax", label: "Tax center" },
      { key: "assets", label: "Assets" },
      { key: "debt", label: "Financing" },
    ],
  },
  {
    key: "costing",
    label: "Costing",
    basePath: "/costing",
    sections: [
      { key: "costing", label: "Costing" },
      { key: "cost-tracking", label: "Cost tracking" },
      { key: "reconciliation", label: "Reconciliation" },
      { key: "cash-requests", label: "Cash requests" },
      { key: "regie", label: "Régie" },
    ],
  },

  {
    key: "hr",
    label: "People & HR",
    basePath: "/hr",
    sections: [
      { key: "employees", label: "Employees" },
      { key: "payroll", label: "Payroll" },
      { key: "advances", label: "Advances" },
      { key: "vacancies", label: "Vacancies" },
      { key: "contracts", label: "Contracts" },
      { key: "appraisals", label: "Appraisals" },
      { key: "queries", label: "Queries" },
      { key: "sanctions", label: "Sanctions" },
      { key: "attendance", label: "Attendance" },
      { key: "leave", label: "Leave" },
      { key: "trainings", label: "Trainings" },
      { key: "sops", label: "SOPs" },
      { key: "talent-pool", label: "Talent pool" },
    ],
  },

  {
    key: "master",
    label: "Master data",
    basePath: "/master",
    sections: [
      { key: "clients", label: "Clients" },
      { key: "suppliers", label: "Suppliers" },
      { key: "corporate-entities", label: "Corporate entities" },
      { key: "treasury-accounts", label: "Treasury" },
      { key: "currencies", label: "Currencies" },
      { key: "expense-rates", label: "Expense rates" },
      { key: "financial-dictionary", label: "Financial dictionary" },
      { key: "tax-jurisdictions", label: "Tax" },
      { key: "service-types", label: "Service types" },
    ],
  },
  {
    key: "vault",
    label: "Vault & compliance",
    basePath: "/vault",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "documents", label: "Documents" },
      { key: "signatures", label: "Signatures" },
      { key: "verification", label: "Verification" },
      { key: "compliance-flags", label: "Compliance flags" },
      { key: "reports", label: "Reports" },
    ],
  },
  {
    key: "security",
    label: "Security & access",
    basePath: "/security",
    sections: [
      { key: "overview", label: "Overview" },
      { key: "users", label: "Users" },
      { key: "roles", label: "Roles" },
      { key: "permissions", label: "Permission matrix" },
      { key: "capabilities", label: "Capabilities" },
      { key: "scopes", label: "Scopes" },
      { key: "field-visibility", label: "Field visibility" },
      { key: "sessions", label: "Sessions" },
      { key: "my-security", label: "My security" },
    ],
  },
  {
    key: "governance",
    label: "Governance",
    basePath: "/governance",
    // Routed at the top level rather than under /governance — the hub is a card
    // grid over four standalone screens, which predates the hub.
    sections: [
      { key: "approvals", label: "Approvals", to: "/approvals" },
      { key: "workflows", label: "Workflows", to: "/workflows" },
      { key: "audit", label: "Audit ledger", to: "/audit" },
      { key: "notifications", label: "Notifications", to: "/notifications" },
    ],
  },
  {
    key: "ai-control",
    label: "AI Control",
    basePath: "/ai-control",
    sections: [
      { key: "features", label: "Features" },
      { key: "access", label: "Access" },
      { key: "budget", label: "Budget" },
      { key: "usage", label: "Usage" },
    ],
  },
  {
    key: "settings",
    label: "Settings & admin",
    basePath: "/settings",
    // The Settings hub is a card grid over two dozen editors, and a ribbon row
    // holding two dozen items is a list, not a row. These are the ones an
    // administrator opens repeatedly; the card grid at /settings remains the
    // complete index and is reachable from the area itself.
    sections: [
      { key: "appearance", label: "Appearance", to: "/appearance" },
      { key: "numbering", label: "Numbering" },
      { key: "document-templates", label: "Templates" },
      { key: "custom-fields", label: "Custom fields" },
      { key: "pipeline-stages", label: "Pipeline stages" },
      { key: "scheduled-reports", label: "Scheduled reports" },
      { key: "api-keys", label: "API keys" },
      { key: "catalogue", label: "Module catalogue" },
    ],
  },
  { key: "godmode", label: "God mode", basePath: "/godmode", sections: [] },
];

const BY_PATH = new Map(AREAS.map((a) => [a.basePath, a]));

/** One hub tab: a section, plus the page that renders it. */
export type HubTab = {
  key: string;
  label: string;
  Component: React.ComponentType;
};

/**
 * Build a hub's tabs from the shared section list plus this hub's page
 * components, keyed by section. `<TabbedHub tabs={hubTabs("/fleet", {…})}>`.
 *
 * A section with no component is DROPPED rather than throwing. A hub is a
 * routed screen: throwing here would take the whole area down for a typo in a
 * key, where dropping costs one missing tab. `areas.test.ts` asserts nothing is
 * ever dropped, so the mistake fails CI instead of production.
 *
 * Lives here rather than beside `TabbedHub` so that file exports components
 * only — a module that mixes the two breaks React Fast Refresh, which the lint
 * config reports.
 */
export function hubTabs(
  basePath: string,
  components: Record<string, React.ComponentType>,
): HubTab[] {
  return sectionsOf(basePath)
    .filter((s) => !!components[s.key])
    .map((s) => ({ key: s.key, label: s.label, Component: components[s.key] }));
}

/** Where a section actually points. */
export function sectionRoute(area: Area, section: AreaSection): string {
  return section.to ?? `${area.basePath}/${section.key}`;
}

/** An area's landing route. */
export function areaRoute(area: Area): string {
  return area.to ?? area.basePath;
}

/** The sections a hub at `basePath` owns. Empty for an unknown path rather than
 *  throwing: a hub that has not been added here should render no tabs, not take
 *  the screen down. `areas.test.ts` is what makes "not added here" a CI failure. */
export function sectionsOf(basePath: string): AreaSection[] {
  return BY_PATH.get(basePath)?.sections ?? [];
}

/**
 * The area a path is inside, longest prefix first.
 *
 * `/master` must not match `/my-appearance`, so a match requires the path to be
 * the base itself or to continue with a `/`. Control Tower (`basePath: ""`) is
 * excluded from prefix matching entirely and handled as the exact `/` case —
 * an empty prefix matches everything.
 */
export function areaForPath(pathname: string): Area | undefined {
  if (pathname === "/") return AREAS.find((a) => a.key === "tower");
  let best: Area | undefined;
  for (const a of AREAS) {
    if (!a.basePath) continue;
    if (pathname !== a.basePath && !pathname.startsWith(a.basePath + "/"))
      continue;
    if (!best || a.basePath.length > best.basePath.length) best = a;
  }
  if (best) return best;
  // A section routed outside its area (Governance's four) — match by route.
  return AREAS.find((a) =>
    a.sections.some(
      (s) => s.to && (pathname === s.to || pathname.startsWith(s.to + "/")),
    ),
  );
}
