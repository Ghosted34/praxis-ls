/**
 * Per-area accessibility gate (Phase 4 validation: "axe, zero violations").
 *
 * Every screen listed here is rendered in all four of its states and scanned.
 * The four states are the point, not a thoroughness flourish: the audit found
 * screens that only had one or two (F10 counted 28 ad-hoc "Loading…" strings
 * where a skeleton belonged; F11 found 11 screens with no empty state at all),
 * and a happy-path smoke test would have passed on every one of them.
 *
 * WHAT EACH STATE CATCHES, from the findings:
 *   loading    a bare string where a skeleton belongs, and skeletons with no
 *              role/label (F10).
 *   error      a screen that renders its error as raw text, or swallows a 403
 *              into an "all clear" empty state — the Control Tower shipped
 *              exactly that to production (Addendum 6, defect 4).
 *   empty      a screen with no empty state, or one whose copy is the developer
 *              default "No records returned." (F11).
 *   populated  the real tree: heading order, table semantics, named controls.
 *
 * THIS GATE PAID FOR ITSELF ON ITS FIRST RUN. Against one already-migrated
 * screen it found that every list table in the app shipped an EMPTY `<th>` for
 * its row-actions column — `empty-table-header`, on ~90 screens, invisible to
 * every primitive test because it only exists once a column spec meets a table.
 * Fixed in `data-list.tsx`'s `headerLabel`.
 *
 * ADDING A SCREEN. Add an entry to AREAS. If it needs data to render something
 * interesting, give it a `routes` fixture. That is the whole cost, and it is
 * what makes "this area is axe clean" a fact rather than a claim.
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

import { apiClientMock, authContextMock, renderScreen, apiError, type ScreenFixtures } from "@/test/screen-harness";

// Hoisted above every import below — which is why the screens are imported after.
vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { InvoicesPage } from "./finance/invoices";
import { ChartOfAccountsPage } from "./finance/chart-of-accounts";
import { JournalsPage } from "./finance/journals";
import { OperationsFilesPage } from "./operations/operation-files";
import { ServiceTypesPage } from "./operations/service-types";
import * as sales from "./sales/pages";
import * as security from "./security/pages";
import * as vault from "./vault/pages";
import * as commercial from "./commercial/pages";
import * as governance from "./governance/pages";
import * as master from "./master/pages";
import * as masterdata from "./masterdata/pages";
import * as procurement from "./procurement/pages";
import * as settingsConfig from "./settings/config-pages";
import * as settingsStore from "./settings/store-pages";
import * as settingsMd from "./settings/master-data-pages";
import * as aiControl from "./ai-control/pages";
import * as costing from "./costing/pages";

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const CLIENTS = [
  { client_id: "c1", name: "Bolloré Logistics", legal_name: "Bolloré Logistics SA", is_active: true, credit_limit: 50_000_000 },
  { client_id: "c2", name: "Nestlé Cameroun", legal_name: "Nestlé Cameroun SA", is_active: true, credit_limit: 20_000_000 },
];
const ENTITIES = [{ entity_id: "e1", code: "SBX", legal_name: "SmartBox SARL", name: "SmartBox", is_active: true }];
const USERS = [{ user_id: "u1", full_name: "Amina Ndoumbe", email: "amina@example.test", is_active: true, roles: [] }];

type ScreenCase = {
  name: string;
  render: () => React.ReactElement;
  /** Data that makes the populated state non-trivial. */
  routes?: Record<string, unknown>;
  /** Text proving the populated state rendered rows rather than an empty state. */
  populatedProof?: RegExp;
  /**
   * Which states this screen actually HAS. Defaults to all four.
   *
   * The only legitimate reason to narrow this is a screen that fetches nothing
   * on arrival — a search-first lookup has no loading or error state until the
   * user asks it something. Narrowing it because a screen is MISSING a state it
   * should have is the defect this file exists to catch, so every entry here
   * needs a comment saying which it is.
   */
  states?: ("loading" | "error" | "empty" | "populated")[];
};

type Area = { area: string; screens: ScreenCase[] };

/* ── the register ─────────────────────────────────────────────────────────── */

const AREAS: Area[] = [
  {
    area: "Finance",
    screens: [
      {
        name: "Invoices",
        render: () => <InvoicesPage />,
        routes: {
          "/final-invoices": [
            { invoice_id: "i1", doc_number: "FIN-2026-0001", client_id: "c1", status: "ISSUED", total_ttc: 4_500_000, created_at: "2026-07-01" },
            { invoice_id: "i2", doc_number: null, client_id: "c2", status: "DRAFT", total_ttc: 1_250_000, created_at: "2026-07-14" },
          ],
          "/clients": CLIENTS,
        },
        populatedProof: /FIN-2026-0001/,
      },
      {
        name: "Chart of accounts",
        render: () => <ChartOfAccountsPage />,
        routes: { "/chart-of-accounts": [{ account_id: "a1", account_code: "401000", name: "Fournisseurs", account_class: 4, is_active: true }] },
      },
      {
        name: "Journals",
        render: () => <JournalsPage />,
        routes: { "/journal-entries": [{ entry_id: "j1", ref: "JRN-0001", entry_date: "2026-07-01", status: "POSTED", memo: "Opening" }] },
      },
    ],
  },
  {
    area: "Operations",
    screens: [
      {
        name: "Operation files",
        render: () => <OperationsFilesPage />,
        routes: {
          "/operations": [{ operation_id: "o1", ref: "SBX-OPS-2026-0142", client_id: "c1", status: "IN_PROGRESS", service_key: "SEA_IMPORT" }],
          "/clients": CLIENTS,
          "/service-types": [{ service_type_id: "s1", service_key: "SEA_IMPORT", name: "Sea import" }],
        },
      },
      {
        name: "Service types",
        render: () => <ServiceTypesPage />,
        routes: { "/service-types": [{ service_type_id: "s1", service_key: "SEA_IMPORT", name: "Sea import", is_active: true }] },
      },
    ],
  },
  {
    area: "Sales",
    screens: [
      {
        name: "Leads",
        render: () => <sales.LeadsPage />,
        routes: {
          "/leads": [{ lead_id: "l1", company_name: "Cimencam", contact_name: "Paul M.", status: "NEW", source: "WEBSITE", created_at: "2026-07-02" }],
          "/intake": [],
        },
      },
      {
        name: "Meetings",
        render: () => <sales.MeetingsPage />,
        routes: {
          "/meetings": [{ meeting_id: "m1", subject: "Kick-off", scheduled_at: "2026-07-10T09:00:00Z", status: "SCHEDULED" }],
          "/leads": [],
          "/clients": CLIENTS,
        },
      },
      {
        name: "Opportunities",
        render: () => <sales.OpportunitiesPage />,
        routes: {
          "/opportunities/stages": [{ pipeline_stage_id: "p1", name: "Qualified", sort_order: 1 }],
          "/opportunities": [{ opportunity_id: "op1", name: "Douala corridor", pipeline_stage_id: "p1", status: "OPEN", estimated_value: 12_000_000, probability: 40 }],
          "/leads": [],
          "/clients": CLIENTS,
          "/entities": ENTITIES,
        },
      },
      {
        name: "Proposals",
        render: () => <sales.ProposalsPage />,
        routes: {
          "/proposals": [{ proposal_id: "pr1", title: "Corridor proposal", status: "DRAFT", total: 3_000_000 }],
          "/leads": [],
          "/clients": CLIENTS,
          "/opportunities": [],
        },
      },
      {
        name: "Campaigns",
        render: () => <sales.CampaignsPage />,
        routes: {
          "/campaigns": [{ campaign_id: "ca1", name: "Q3 push", channel: "EMAIL", status: "DRAFT" }],
          "/subscribers": [],
          "/templates": [],
          "/senders": [],
        },
      },
      {
        name: "Success stories",
        render: () => <sales.SuccessStoriesPage />,
        routes: { "/success-stories": [{ story_id: "st1", title: "Port turnaround", is_published: true }] },
      },
    ],
  },
  {
    area: "Security",
    screens: [
      { name: "Users", render: () => <security.UsersPage />, routes: { "/users": USERS, "/roles": [{ role_id: "r1", name: "Ops", code: "OPS" }] } },
      { name: "Roles", render: () => <security.RolesPage />, routes: { "/roles": [{ role_id: "r1", name: "Ops", code: "OPS", description: "Operations" }] } },
      { name: "Capabilities", render: () => <security.CapabilitiesPage />, routes: { "/capabilities": [{ capability_id: "cap1", code: "ops.read", description: "Read ops" }] } },
      { name: "Field visibility", render: () => <security.FieldVisibilityPage />, routes: { "/field-visibility": [{ id: "fv1", table_name: "clients", column_name: "credit_limit", visibility: "masked" }], "/roles": [] } },
      { name: "Sessions", render: () => <security.SessionsPage />, routes: { "/sessions": [{ session_id: "s1", user_id: "u1", created_at: "2026-07-01", ip: "10.0.0.1" }] } },
    ],
  },
  {
    area: "Vault",
    screens: [
      { name: "Reports", render: () => <vault.ReportsPage />, routes: { "/reports/catalogue": [{ report_key: "ar_ageing", name: "AR ageing", describe: "Receivables by bucket" }], "/reports/saved": [], "/reports/tiles": [] } },
      { name: "Compliance flags", render: () => <vault.ComplianceFlagsPage />, routes: { "/compliance": [{ flag_id: "f1", severity: "HIGH", status: "OPEN", describe: "Missing BL" }], "/compliance/catalogue": [] } },
      { name: "Documents", render: () => <vault.DocumentsPage />, routes: { "/documents": [{ document_id: "d1", filename: "bl.pdf", entity_ref: "OPS-1", created_at: "2026-07-01" }] } },
      {
        // Search-first: nothing is fetched until a document reference is typed,
        // so on arrival there is no request to be loading or to fail. Its
        // "empty" IS its initial state, which is the correct design for a lookup
        // screen and is why `states` narrows what this case asserts.
        name: "Signatures",
        render: () => <vault.SignaturesPage />,
        routes: { "/signatures": [{ signature_id: "sg1", entity_ref: "OPS-1", signer: "Amina", signed_at: "2026-07-02" }] },
        states: ["empty", "populated"],
      },
    ],
  },
  {
    area: "Commercial",
    screens: [
      {
        name: "Quotations",
        render: () => <commercial.QuotationsPage />,
        routes: {
          "/quotations": [{ quotation_id: "q1", ref: "QT-2026-001", client_id: "c1", status: "DRAFT", total: 8_000_000 }],
          "/clients": CLIENTS,
          "/entities": ENTITIES,
          "/opportunities": [],
        },
      },
      { name: "Margin simulations", render: () => <commercial.MarginSimulationsPage />, routes: { "/margin-simulations": [{ simulation_id: "ms1", name: "Corridor", margin_percent: 18 }] } },
      { name: "Extra-charge simulations", render: () => <commercial.ExtraChargeSimulationsPage />, routes: { "/extra-charge-simulations": [{ simulation_id: "es1", name: "Demurrage" }] } },
      { name: "Pricing variance", render: () => <commercial.PricingVariancePage />, routes: { "/pricing-variance": [{ variance_id: "v1", operation_id: "o1", delta: -120000 }], "/operations": [], "/quotations": [] } },
    ],
  },
  {
    area: "Governance",
    screens: [
      { name: "Audit", render: () => <governance.AuditPage />, routes: { "/audit": [{ ledger_id: "al1", action: "UPDATE", table_name: "clients", actor_id: "u1", created_at: "2026-07-01" }], "/users": USERS } },
      { name: "Notifications", render: () => <governance.NotificationsPage />, routes: { "/notifications": [{ notification_id: "n1", title: "Approval needed", channel: "IN_APP", created_at: "2026-07-01" }] } },
      { name: "Workflows", render: () => <governance.WorkflowsPage />, routes: { "/workflows": [{ workflow_id: "w1", name: "Invoice approval", event_type_key: "INVOICE_SUBMIT", step_count: 2, is_active: true }] } },
      { name: "Approvals", render: () => <governance.ApprovalsPage />, routes: { "/approvals": [{ task_id: "t1", step_kind: "APPROVE", status: "PENDING", entity_ref: "INV-1" }] } },
    ],
  },
  {
    area: "Master data",
    screens: [
      { name: "Clients", render: () => <master.ClientsPage />, routes: { "/clients": CLIENTS, "/entities": ENTITIES } },
      { name: "Suppliers", render: () => <master.SuppliersPage />, routes: { "/suppliers": [{ supplier_id: "s1", name: "Total Energies", is_active: true }], "/entities": ENTITIES } },
      { name: "Corporate entities", render: () => <master.CorporateEntitiesPage />, routes: { "/entities": ENTITIES } },
      { name: "Expense rates", render: () => <masterdata.ExpenseRatesPage />, routes: { "/expense-rates": [{ expense_rate_id: "er1", code: "PERDIEM", amount: 25000, currency: "XAF" }] } },
      { name: "Financial dictionary", render: () => <masterdata.FinancialDictionaryPage />, routes: { "/financial-dictionary": [{ dictionary_item_id: "di1", label: "Transit fee", category: "service", context: "sale" }] } },
    ],
  },
  {
    area: "Procurement",
    screens: [
      { name: "Purchase requests", render: () => <procurement.PurchaseRequestsPage />, routes: { "/purchase-requests": [{ pr_id: "pr1", ref: "PR-2026-001", status: "DRAFT", justification: "Spares" }] } },
      { name: "Purchase orders", render: () => <procurement.PurchaseOrdersPage />, routes: { "/purchase-orders": [{ po_id: "po1", ref: "PO-2026-001", status: "OPEN" }], "/suppliers": [] } },
      { name: "Goods received", render: () => <procurement.GoodsReceivedPage />, routes: { "/goods-received": [{ grn_id: "g1", ref: "GRN-001", status: "RECEIVED" }], "/purchase-orders": [] } },
      { name: "Supplier invoices", render: () => <procurement.SupplierInvoicesPage />, routes: { "/supplier-invoices": [{ invoice_id: "si1", ref: "SI-001", status: "PENDING", amount: 900000 }], "/suppliers": [] } },
    ],
  },
  {
    area: "Settings",
    screens: [
      { name: "Bank accounts", render: () => <settingsConfig.BankAccountsPage />, routes: { "/treasury-accounts": [{ account_id: "b1", label: "SGC main", bank_name: "SGC", currency: "XAF" }], "/entities": ENTITIES } },
      { name: "Payment gateways", render: () => <settingsConfig.PaymentGatewaysPage />, routes: { "/payment-gateways": [{ gateway_id: "g1", provider: "MTN", is_active: true }] } },
      { name: "Scheduled reports", render: () => <settingsConfig.ScheduledReportsPage />, routes: { "/reports/scheduled": [{ schedule_id: "s1", report_key: "ar_ageing", cadence: "weekly" }], "/reports/catalogue": [] } },
      { name: "API keys", render: () => <settingsConfig.ApiKeysPage />, routes: { "/settings/integration_secret": [{ key: "exchangerate", last4: "9f2a" }] } },
      { name: "Pipeline stages", render: () => <settingsConfig.PipelineStagesPage />, routes: { "/opportunities/stages": [{ pipeline_stage_id: "p1", name: "Qualified", sort_order: 1 }] } },
      { name: "Custom fields", render: () => <settingsStore.CustomFieldsPage />, routes: { "/settings": [] } },
      { name: "Email signatures", render: () => <settingsStore.EmailSignaturesPage />, routes: { "/settings": [] } },
      { name: "Business policies", render: () => <settingsStore.BusinessPoliciesPage />, routes: { "/settings": [] } },
      { name: "Currencies", render: () => <settingsMd.CurrenciesPage />, routes: { "/currencies": [{ code: "XAF", name: "CFA franc", rate: 1 }] } },
      { name: "Tax jurisdictions", render: () => <settingsMd.TaxJurisdictionsPage />, routes: { "/tax-jurisdictions": [{ jurisdiction_id: "tj1", country_code: "CM", name: "Cameroon", currency: "XAF", is_active: true }] } },
    ],
  },
  {
    area: "AI control",
    screens: [
      { name: "AI vendors", render: () => <aiControl.AiVendorsPage />, routes: { "/ai": [{ vendor: "anthropic", current_model: "claude", has_key: true, is_active: true }] } },
      { name: "AI features", render: () => <aiControl.AiFeaturesPage />, routes: { "/ai": [{ feature_key: "summarise", is_enabled: true }] } },
    ],
  },
  {
    area: "Costing",
    screens: [
      { name: "Costing", render: () => <costing.CostingPage />, routes: { "/costings": [{ costing_id: "co1", ref: "CST-001", status: "DRAFT", total: 5_000_000 }], "/operations": [] } },
    ],
  },
];

/* ── the gate ─────────────────────────────────────────────────────────────── */

const CASES = AREAS.flatMap((a) => a.screens.map((s) => ({ ...s, area: a.area })));

describe.each(CASES)("$area › $name", ({ render: renderCase, routes, populatedProof, states }) => {
  const has = (s: string) => !states || states.includes(s as never);

  it.runIf(has("loading"))("loading state is clean and announced", async () => {
    const { container } = renderScreen(renderCase(), { pending: true });
    // F10: skeletons carry role="status" so the wait is announced rather than
    // being a silent blank region.
    expect(container.querySelector('[role="status"], [aria-busy="true"]')).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it.runIf(has("error"))("error state is clean and says what went wrong", async () => {
    const f: ScreenFixtures = {
      routes: Object.fromEntries(Object.keys(routes ?? {}).map((k) => [k, apiError(403, "You don't have permission to view this.")])),
    };
    const { container } = renderScreen(renderCase(), f);
    await waitFor(() => expect(container.textContent).toMatch(/permission|failed|unable|error|wrong/i));
    // Addendum 6 defect 4: a 403 must NOT resolve into a reassuring empty state.
    expect(container.textContent).not.toMatch(/all clear/i);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("empty state is clean and is not the developer default", async () => {
    const f: ScreenFixtures = { routes: Object.fromEntries(Object.keys(routes ?? {}).map((k) => [k, []])) };
    const { container } = renderScreen(renderCase(), f);
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeFalsy());
    // F11: "No records returned." is the fallback nobody should be shipping.
    expect(container.textContent).not.toMatch(/No records returned\./);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("populated state is clean, with exactly one h1", async () => {
    const { container } = renderScreen(renderCase(), { routes });
    if (populatedProof) await waitFor(() => expect(container.textContent).toMatch(populatedProof));
    // F13: 116 of 117 pages had no h1 at all. Two competing h1s is the other
    // failure mode, and just as wrong.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * REGRESSION: a permission failure must not be reported as a disabled feature.
 *
 * Found by the gate above, and worth pinning on its own because the two states
 * look almost identical on screen and lead the user to opposite remedies.
 *
 * `errMsg` renders every 403 as "You don't have permission to do this.", and the
 * old `isGated` regex matched `/permission/` in that sentence. So a user missing
 * the reports GRANT was shown "Reporting isn't enabled for this tenant" and sent
 * to a developer-dashboard feature flag that was already switched on. The actual
 * cause — their role — was never mentioned to them or to the admin they asked.
 *
 * Same family as the Control Tower defect in Addendum 6, where any 403 fell into
 * an empty state that told the user everything was fine.
 */
describe("403 vs FEATURE_DISABLED (Vault reports)", () => {
  const paths = { "/reports/catalogue": null, "/reports/saved": null, "/reports/tiles": null };

  it("a missing GRANT reports a permission problem, not a feature flag", async () => {
    const routes = Object.fromEntries(Object.keys(paths).map((k) => [k, apiError(403, "You don't have permission to do this.", "FORBIDDEN")]));
    const { container } = renderScreen(<vault.ReportsPage />, { routes });
    await waitFor(() => expect(container.textContent).toMatch(/permission/i));
    expect(container.textContent).not.toMatch(/isn't enabled|feature flag/i);
  });

  it("a genuinely disabled FEATURE still says so, and names the remedy", async () => {
    const routes = Object.fromEntries(Object.keys(paths).map((k) => [k, apiError(403, "Feature 'reports' is off for this tenant", "FEATURE_DISABLED")]));
    const { container } = renderScreen(<vault.ReportsPage />, { routes });
    await waitFor(() => expect(container.textContent).toMatch(/isn't enabled/i));
    expect(container.textContent).toMatch(/developer dashboard/i);
  });
});
