/**
 * Master Data hub — the eight reference registries folded into one screen as
 * deep-linkable tabs (FE_DESIGN_RULES §4: build the parent, fold children in,
 * collapse the menu to a single entry). Each tab renders its existing page
 * component unchanged, so per-module RBAC, org-workflow and the API contract are
 * all unaffected — this is purely a frontend regrouping.
 *
 * Routes stay deep-linkable (`/master/<section>`), so bookmarks, screen-registry
 * and Praxis navigation ("take me to suppliers") keep working; only the nav menu
 * collapses to one "Master data" entry.
 *
 * Uses the shared `TabbedHub` shell (components/tabbed-hub.tsx) — this file used
 * to hand-roll an identical tab bar; converged at the 2026-07-18 merge so every
 * hub (operations / procurement / costing / ai-control / master data) shares one
 * implementation and one active-tab style.
 */
import { TabbedHub } from "@/components/tabbed-hub";
import { hubTabs } from "@/app/layout/areas";
import { ClientsPage } from "./client-360"; // customer 360 (replaces the flat clients CRUD)
import { SuppliersPage } from "./suppliers";
import { CorporateEntitiesPage } from "./corporate-entities";
import { ExpenseRatesPage } from "./expense-rates";
import { FinancialDictionaryPage } from "./financial-dictionary";
import { ServiceTypesPage } from "./service-types";
import { CurrenciesPage } from "@/features/settings/currencies";
import { TaxJurisdictionsPage } from "@/features/settings/tax-jurisdictions";
// The old flat Bank accounts table is replaced by the rich Treasury master —
// a master-detail with 360, category chips ("+ New category" for e.g. Airtel
// SmartCash), and auto-minted CoA leaves. See 0520_treasury_master_rich.sql.
import { TreasuryMasterPage } from "@/features/master/treasury";

const TABS = hubTabs("/master", {
  clients: ClientsPage,
  suppliers: SuppliersPage,
  "corporate-entities": CorporateEntitiesPage,
  "treasury-accounts": TreasuryMasterPage,
  currencies: CurrenciesPage,
  "expense-rates": ExpenseRatesPage,
  "financial-dictionary": FinancialDictionaryPage,
  "tax-jurisdictions": TaxJurisdictionsPage,
  // Service types — the taxonomy IS master data (0310_operations.sql:7,
  // "services as DATA, not code"). Backend module stays under operations and
  // rides MOD-29 with the dossier (see service_type.events.js for why
  // re-keying would 403 non-CEO users); this hub tab is a pure UI regrouping.
  "service-types": ServiceTypesPage,
});

export function MasterDataPage() {
  // Costing pattern: each tab page renders its own PageHeader then the HubTabs
  // bar, so the tab strip sits under the page header (not above the breadcrumb).
  return <TabbedHub eyebrow="Master data" basePath="/master" tabs={TABS} />;
}
