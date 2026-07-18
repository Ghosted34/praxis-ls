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
import { TabbedHub, type HubTab } from "@/components/tabbed-hub";
import { ClientsPage, SuppliersPage, CorporateEntitiesPage, ExpenseRatesPage, FinancialDictionaryPage } from "./pages";
import { CurrenciesPage, TaxJurisdictionsPage } from "@/features/settings/master-data-pages";
import { BankAccountsPage } from "@/features/settings/config-pages";

const TABS: HubTab[] = [
  { key: "clients", label: "Clients", Component: ClientsPage },
  { key: "suppliers", label: "Suppliers", Component: SuppliersPage },
  { key: "corporate-entities", label: "Corporate entities", Component: CorporateEntitiesPage },
  { key: "treasury-accounts", label: "Treasury", Component: BankAccountsPage },
  { key: "currencies", label: "Currencies", Component: CurrenciesPage },
  { key: "expense-rates", label: "Expense rates", Component: ExpenseRatesPage },
  { key: "financial-dictionary", label: "Financial dictionary", Component: FinancialDictionaryPage },
  { key: "tax-jurisdictions", label: "Tax", Component: TaxJurisdictionsPage },
];

export function MasterDataPage() {
  // inlineTabs: these tab pages own their own headers and don't call <HubTabs/>,
  // so the shell renders the bar (preserves the previous look exactly).
  return <TabbedHub eyebrow="Master data" basePath="/master" tabs={TABS} inlineTabs />;
}
