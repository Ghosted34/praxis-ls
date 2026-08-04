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
import { LeadsPage } from "./sales/leads";
import { MeetingsPage } from "./sales/meetings";
import { OpportunitiesPage } from "./sales/opportunities";
import { ProposalsPage } from "./sales/proposals";
import { CampaignsPage } from "./sales/campaigns";
import { SuccessStoriesPage } from "./sales/success-stories";
import { UsersPage } from "./security/users";
import { RolesPage } from "./security/roles";
import { CapabilitiesPage } from "./security/capabilities";
import { FieldVisibilityPage } from "./security/field-visibility";
import { SessionsPage } from "./security/sessions";
import { ReportsPage } from "./vault/reports";
import { ComplianceFlagsPage } from "./vault/compliance-flags";
import { DocumentsPage } from "./vault/documents";
import { SignaturesPage } from "./vault/signatures";
import { QuotationsPage } from "./commercial/quotations";
import { MarginSimulationsPage } from "./commercial/margin-simulations";
import { ExtraChargeSimulationsPage } from "./commercial/extra-charge-simulations";
import { PricingVariancePage } from "./commercial/pricing-variance";
import { AuditPage } from "./governance/audit";
import { NotificationsPage } from "./governance/notifications";
import { WorkflowsPage } from "./governance/workflows";
import { ApprovalsPage } from "./governance/approvals";
import { ClientsPage as MasterClientsPage } from "./master/clients";
import { SuppliersPage as MasterSuppliersPage } from "./master/suppliers";
import { CorporateEntitiesPage } from "./master/corporate-entities";
import { ExpenseRatesPage } from "./masterdata/expense-rates";
import { FinancialDictionaryPage } from "./masterdata/financial-dictionary";
import { PurchaseRequestsPage } from "./procurement/purchase-requests";
import { PurchaseOrdersPage } from "./procurement/purchase-orders";
import { GoodsReceivedPage } from "./procurement/goods-received";
import { SupplierInvoicesPage } from "./procurement/supplier-invoices";
import { BankAccountsPage } from "./settings/bank-accounts";
import { PaymentGatewaysPage } from "./settings/payment-gateways";
import { ScheduledReportsPage } from "./settings/scheduled-reports";
import { ApiKeysPage } from "./settings/api-keys";
import { PipelineStagesPage } from "./settings/pipeline-stages";
import { CustomFieldsPage } from "./settings/custom-fields";
import { EmailSignaturesPage } from "./settings/email-signatures";
import { BusinessPoliciesPage } from "./settings/business-policies";
import { CurrenciesPage } from "./settings/currencies";
import { TaxJurisdictionsPage } from "./settings/tax-jurisdictions";
import * as aiControl from "./ai-control/pages";
import * as costing from "./costing/pages";
import { CycleCountsPage } from "./wms/cycle-count";
import { EquipmentPage } from "./wms/equipment";
import { InboundPage } from "./wms/inbound";
import { InventoryPage } from "./wms/inventory";
import { OutboundPage } from "./wms/outbound";
import { VehicleCompliancePage } from "./fleet/compliance";
import { DispatchPage } from "./fleet/dispatch";
import { DriversPage } from "./fleet/drivers";
import { FuelLogPage } from "./fleet/fuel";
import { IncidentsPage } from "./fleet/incidents";
import { WorkOrdersPage } from "./fleet/work-orders";
import { SopsPage } from "./hr/sops";
import { TalentPoolPage } from "./hr/talent-pool";
import { SupportPage } from "./support/support-page";
import { HelpPage } from "./help/help-page";
import { GodModePage } from "./godmode/godmode-page";

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
  /**
   * Set false for a screen that legitimately renders an empty state even with
   * data — a side panel with nothing in it beside a populated list, a board
   * with an empty column. Every use needs a reason: the default exists to catch
   * a fixture that never reached the screen.
   */
  rendersRows?: boolean;
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
        render: () => <LeadsPage />,
        routes: {
          "/leads": [{ lead_id: "l1", company_name: "Cimencam", contact_name: "Paul M.", status: "NEW", source: "WEBSITE", created_at: "2026-07-02" }],
          "/intake": [],
        },
      },
      {
        name: "Meetings",
        render: () => <MeetingsPage />,
        routes: {
          "/meetings": [{ meeting_id: "m1", subject: "Kick-off", scheduled_at: "2026-07-10T09:00:00Z", status: "SCHEDULED" }],
          "/leads": [],
          "/clients": CLIENTS,
        },
      },
      {
        name: "Opportunities",
        render: () => <OpportunitiesPage />,
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
        render: () => <ProposalsPage />,
        routes: {
          "/proposals": [{ proposal_id: "pr1", title: "Corridor proposal", status: "DRAFT", total: 3_000_000 }],
          "/leads": [],
          "/clients": CLIENTS,
          "/opportunities": [],
        },
      },
      {
        name: "Campaigns",
        render: () => <CampaignsPage />,
        routes: {
          "/campaigns": [{ campaign_id: "ca1", name: "Q3 push", channel: "EMAIL", status: "DRAFT" }],
          "/subscribers": [],
          "/templates": [],
          "/senders": [],
        },
      },
      {
        name: "Success stories",
        render: () => <SuccessStoriesPage />,
        routes: { "/success-stories": [{ story_id: "st1", title: "Port turnaround", is_published: true }] },
      },
    ],
  },
  {
    area: "Security",
    screens: [
      { name: "Users", render: () => <UsersPage />, routes: { "/users": USERS, "/roles": [{ role_id: "r1", name: "Ops", code: "OPS" }] } },
      { name: "Roles", render: () => <RolesPage />, routes: { "/roles": [{ role_id: "r1", name: "Ops", code: "OPS", description: "Operations" }] } },
      { name: "Capabilities", render: () => <CapabilitiesPage />, routes: { "/capabilities": [{ capability_id: "cap1", code: "ops.read", description: "Read ops" }] } },
      { name: "Field visibility", render: () => <FieldVisibilityPage />, routes: { "/field-visibility": [{ id: "fv1", table_name: "clients", column_name: "credit_limit", visibility: "masked" }], "/roles": [] } },
      { name: "Sessions", render: () => <SessionsPage />, routes: { "/sessions": [{ session_id: "s1", user_id: "u1", created_at: "2026-07-01", ip: "10.0.0.1" }] } },
    ],
  },
  {
    area: "Vault",
    screens: [
      { name: "Reports", render: () => <ReportsPage />, routes: { "/reports/catalogue": [{ report_key: "ar_ageing", name: "AR ageing", describe: "Receivables by bucket" }], "/reports/saved": [], "/reports/tiles": [] } },
      { name: "Compliance flags", render: () => <ComplianceFlagsPage />, routes: { "/compliance": [{ flag_id: "f1", severity: "HIGH", status: "OPEN", describe: "Missing BL" }], "/compliance/catalogue": [] } },
      { name: "Documents", render: () => <DocumentsPage />, routes: { "/documents": [{ document_id: "d1", filename: "bl.pdf", entity_ref: "OPS-1", created_at: "2026-07-01" }] } },
      {
        // Search-first: nothing is fetched until a document reference is typed,
        // so on arrival there is no request to be loading or to fail. Its
        // "empty" IS its initial state, which is the correct design for a lookup
        // screen and is why `states` narrows what this case asserts.
        name: "Signatures",
        render: () => <SignaturesPage />,
        routes: { "/signatures": [{ signature_id: "sg1", entity_ref: "OPS-1", signer: "Amina", signed_at: "2026-07-02" }] },
        states: ["empty", "populated"],
        // "Enter a reference" IS the arrival state here — the screen fetches
        // nothing until one is typed, so an empty state with data available is
        // correct rather than a fixture that failed to land.
        rendersRows: false,
      },
    ],
  },
  {
    area: "Commercial",
    screens: [
      {
        name: "Quotations",
        render: () => <QuotationsPage />,
        routes: {
          "/quotations": [{ quotation_id: "q1", ref: "QT-2026-001", client_id: "c1", status: "DRAFT", total: 8_000_000 }],
          "/clients": CLIENTS,
          "/entities": ENTITIES,
          "/opportunities": [],
        },
      },
      { name: "Margin simulations", render: () => <MarginSimulationsPage />, routes: { "/margin-simulations": [{ simulation_id: "ms1", name: "Corridor", margin_percent: 18 }] } },
      { name: "Extra-charge simulations", render: () => <ExtraChargeSimulationsPage />, routes: { "/extra-charge-simulations": [{ simulation_id: "es1", name: "Demurrage" }] } },
      { name: "Pricing variance", render: () => <PricingVariancePage />, routes: { "/pricing-variance": [{ variance_id: "v1", operation_id: "o1", delta: -120000 }], "/operations": [], "/quotations": [] } },
    ],
  },
  {
    area: "Governance",
    screens: [
      { name: "Audit", render: () => <AuditPage />, routes: { "/audit": [{ ledger_id: "al1", action: "UPDATE", table_name: "clients", actor_id: "u1", created_at: "2026-07-01" }], "/users": USERS } },
      { name: "Notifications", render: () => <NotificationsPage />, routes: { "/notifications": [{ notification_id: "n1", title: "Approval needed", channel: "IN_APP", created_at: "2026-07-01" }] } },
      { name: "Workflows", render: () => <WorkflowsPage />, routes: { "/workflows": [{ workflow_id: "w1", name: "Invoice approval", event_type_key: "INVOICE_SUBMIT", step_count: 2, is_active: true }] } },
      { name: "Approvals", render: () => <ApprovalsPage />, routes: { "/approvals": [{ task_id: "t1", step_kind: "APPROVE", status: "PENDING", entity_ref: "INV-1" }] } },
    ],
  },
  {
    area: "Master data",
    screens: [
      { name: "Clients", render: () => <MasterClientsPage />, routes: { "/clients": CLIENTS, "/entities": ENTITIES } },
      { name: "Suppliers", render: () => <MasterSuppliersPage />, routes: { "/suppliers": [{ supplier_id: "s1", name: "Total Energies", is_active: true }], "/entities": ENTITIES } },
      { name: "Corporate entities", render: () => <CorporateEntitiesPage />, routes: { "/entities": ENTITIES } },
      { name: "Expense rates", render: () => <ExpenseRatesPage />, routes: { "/expense-rates": [{ expense_rate_id: "er1", dictionary_item_id: "dddddddd-4444", shipping_line: "MAERSK", rate: 25000, currency: "XAF" }], "/financial-dictionary": [] }, populatedProof: /MAERSK/ },
      { name: "Financial dictionary", render: () => <FinancialDictionaryPage />, routes: { "/financial-dictionary": [{ dictionary_item_id: "di1", label: "Transit fee", category: "service", context: "sale" }] } },
    ],
  },
  {
    area: "Procurement",
    screens: [
      { name: "Purchase requests", render: () => <PurchaseRequestsPage />, routes: { "/purchase-requests": [{ pr_id: "pr1", ref: "PR-2026-001", status: "DRAFT", justification: "Spares" }] } },
      { name: "Purchase orders", render: () => <PurchaseOrdersPage />, routes: { "/purchase-orders": [{ po_id: "po1", ref: "PO-2026-001", status: "OPEN" }], "/suppliers": [] } },
      { name: "Goods received", render: () => <GoodsReceivedPage />, routes: { "/goods-received": [{ grn_id: "g1", ref: "GRN-001", status: "RECEIVED" }], "/purchase-orders": [] } },
      { name: "Supplier invoices", render: () => <SupplierInvoicesPage />, routes: { "/supplier-invoices": [{ invoice_id: "si1", ref: "SI-001", status: "PENDING", amount: 900000 }], "/suppliers": [] } },
    ],
  },
  {
    area: "Settings",
    screens: [
      { name: "Bank accounts", render: () => <BankAccountsPage />, routes: { "/treasury-accounts": [{ account_id: "b1", label: "SGC main", bank_name: "SGC", currency: "XAF" }], "/entities": ENTITIES } },
      { name: "Payment gateways", render: () => <PaymentGatewaysPage />, routes: { "/payment-gateways": [{ gateway_id: "g1", provider: "MTN", is_active: true }] } },
      { name: "Scheduled reports", render: () => <ScheduledReportsPage />, routes: { "/reports/scheduled": [{ schedule_id: "s1", report_key: "ar_ageing", cadence: "weekly" }], "/reports/catalogue": [] } },
      { name: "API keys", render: () => <ApiKeysPage />, routes: { "/settings/integration_secret": [{ key: "exchangerate", last4: "9f2a" }] } },
      { name: "Pipeline stages", render: () => <PipelineStagesPage />, routes: { "/opportunities/stages": [{ pipeline_stage_id: "p1", name: "Qualified", sort_order: 1 }] } },
      { name: "Custom fields", render: () => <CustomFieldsPage />, routes: { "/settings": [] } },
      { name: "Email signatures", render: () => <EmailSignaturesPage />, routes: { "/settings": [] } },
      { name: "Business policies", render: () => <BusinessPoliciesPage />, routes: { "/settings": [] } },
      { name: "Currencies", render: () => <CurrenciesPage />, routes: { "/currencies": [{ code: "XAF", name: "CFA franc", rate: 1 }] } },
      { name: "Tax jurisdictions", render: () => <TaxJurisdictionsPage />, routes: { "/tax-jurisdictions": [{ jurisdiction_id: "tj1", country_code: "CM", name: "Cameroon", currency: "XAF", is_active: true }] } },
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
  {
    area: "WMS",
    screens: [
      { name: "Cycle counts", render: () => <CycleCountsPage />, routes: { "/cycle-counts": [{ cycle_count_id: "cc1", ref: "CC-001", status: "OPEN", location_id: "loc1" }], "/warehouse-locations": [] } },
      { name: "Equipment", render: () => <EquipmentPage />, routes: { "/equipment": [{ equipment_id: "eq1", code: "FL-01", kind: "FORKLIFT", is_active: true }] } },
      { name: "Inbound", render: () => <InboundPage />, routes: { "/inbound": [{ grn_inbound_id: "aaaaaaaa-1111", qa_status: "HOLD", putaway_location: "A-01", created_at: "2026-07-01" }] }, populatedProof: /aaaaaaaa/ },
      { name: "Inventory", render: () => <InventoryPage />, routes: { "/inventory": [{ inventory_item_id: "it1", sku: "SKU-1", description: "Pallet", qty_on_hand: 12 }] } },
      { name: "Outbound", render: () => <OutboundPage />, routes: { "/outbound": [{ outbound_order_id: "bbbbbbbb-2222", status: "PICKING", created_at: "2026-07-01" }] }, populatedProof: /bbbbbbbb/ },
    ],
  },
  {
    area: "Fleet",
    screens: [
      { name: "Compliance", render: () => <VehicleCompliancePage />, routes: { "/vehicle-compliance": [{ compliance_id: "vc1", vehicle_id: "v1", registration: "LT-1234-AB", kind: "INSURANCE", expires_on: "2026-12-31" }], "/vehicles": [] } },
      { name: "Dispatch", render: () => <DispatchPage />, routes: { "/dispatch": [{ fleet_dispatch_id: "cccccccc-3333", registration: "LT-1234-AB", driver_name: "Jean K.", status: "ASSIGNED" }], "/vehicles": [], "/drivers": [] }, populatedProof: /LT-1234-AB/ },
      { name: "Drivers", render: () => <DriversPage />, routes: { "/drivers": [{ driver_id: "dr1", full_name: "Jean K.", licence_no: "CM-001", is_active: true }] } },
      { name: "Fuel log", render: () => <FuelLogPage />, routes: { "/fuel": [{ fuel_log_id: "f1", vehicle_id: "v1", litres: 60, cost: 45000, logged_on: "2026-07-01" }], "/vehicles": [] } },
      { name: "Incidents", render: () => <IncidentsPage />, routes: { "/incidents": [{ incident_id: "i1", ref: "INC-001", severity: "LOW", status: "OPEN" }], "/vehicles": [] } },
      { name: "Work orders", render: () => <WorkOrdersPage />, routes: { "/work-orders": [{ work_order_id: "w1", ref: "WO-001", status: "OPEN" }], "/vehicles": [] } },
    ],
  },
  {
    area: "HR",
    screens: [
      { name: "SOPs", render: () => <SopsPage />, routes: { "/sops": [{ sop_document_id: "s1", title: "Cargo handling", category: "Ops", version_no: 2, is_active: true }], "/onboarding": [], "/employees": [] } },
      { name: "Talent pool", render: () => <TalentPoolPage />, routes: { "/talent-pool": [{ talent_pool_id: "t1", full_name: "Marie N.", skills: "Customs" }], "/succession": [{ succession_id: "sc1", role_title: "Head of Ops", employee_id: "e1", readiness: "ready_now" }], "/employees": [{ employee_id: "e1", full_name: "Marie N." }] }, populatedProof: /Marie N\./ },
    ],
  },
  {
    area: "Support & admin",
    screens: [
      { name: "Support", render: () => <SupportPage />, routes: { "/support": [{ ticket_id: "t1", title: "Cannot post journal", status: "OPEN", created_at: "2026-07-01" }] } },
      {
        // Static content: zero network calls, so there is no loading or error
        // state for this screen to be missing. Verified by reading it, not
        // assumed — `grep -c "useList\|useResource\|tenant("` returns 0.
        name: "Help",
        render: () => <HelpPage />,
        routes: {},
        states: ["populated"],
      },
      { name: "God mode", render: () => <GodModePage />, routes: { "/god-mode/soft-deletes": [{ soft_delete_id: "g1", table_name: "clients", deleted_at: "2026-07-01", is_accounting_connected: false }] } },
    ],
  },
];

/* ── the gate ─────────────────────────────────────────────────────────────── */

const CASES = AREAS.flatMap((a) => a.screens.map((s) => ({ ...s, area: a.area })));

describe.each(CASES)("$area › $name", ({ render: renderCase, routes, populatedProof, states, rendersRows }) => {
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

    /*
     * THE FIXTURE ACTUALLY REACHED THE SCREEN.
     *
     * This is the guard this file most needed, and it is here because the same
     * mistake was made SEVEN times while building the register: a fixture keyed
     * on a path the screen does not call (`/godmode` for `/god-mode/soft-deletes`,
     * `/scheduled-reports` for `/reports/scheduled`, `/vehicles` for
     * `/vehicle-compliance`). Nothing arrives, the screen renders its EMPTY
     * state, and all four assertions pass — an axe-clean empty table is
     * axe-clean and completely worthless as coverage.
     *
     * So: if the fixture supplied rows, the screen must not be sitting in its
     * empty state. `border-dashed` is EmptyState's own marker. Screens that
     * legitimately show one (a panel with no data beside a populated list) opt
     * out via `rendersRows: false`, with a reason.
     */
    const suppliedRows = Object.values(routes ?? {}).some((v) => Array.isArray(v) && v.length > 0);
    if (suppliedRows && rendersRows !== false) {
      await waitFor(() =>
        expect(
          container.querySelector(".border-dashed"),
          "fixture supplied rows but the screen is showing an empty state — the fixture path probably does not match what this screen fetches",
        ).toBeNull(),
      );
    }
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
    const { container } = renderScreen(<ReportsPage />, { routes });
    await waitFor(() => expect(container.textContent).toMatch(/permission/i));
    expect(container.textContent).not.toMatch(/isn't enabled|feature flag/i);
  });

  it("a genuinely disabled FEATURE still says so, and names the remedy", async () => {
    const routes = Object.fromEntries(Object.keys(paths).map((k) => [k, apiError(403, "Feature 'reports' is off for this tenant", "FEATURE_DISABLED")]));
    const { container } = renderScreen(<ReportsPage />, { routes });
    await waitFor(() => expect(container.textContent).toMatch(/isn't enabled/i));
    expect(container.textContent).toMatch(/developer dashboard/i);
  });
});
