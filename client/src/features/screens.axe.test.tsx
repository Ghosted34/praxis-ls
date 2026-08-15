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

import {
  apiClientMock,
  authContextMock,
  renderScreen,
  apiError,
  type ScreenFixtures,
} from "@/test/screen-harness";

// Hoisted above every import below — which is why the screens are imported after.
vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { InvoicesPage } from "./finance/invoices";
import { ChartOfAccountsPage } from "./finance/chart-of-accounts";
import { JournalsPage } from "./finance/journals";
import { OperationsFilesPage } from "./operations/operation-files";
import { ServiceTypesPage } from "./masterdata/service-types";
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
import { CorporateEntitiesPage } from "./masterdata/corporate-entities";
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
  {
    client_id: "c1",
    name: "Bolloré Logistics",
    legal_name: "Bolloré Logistics SA",
    is_active: true,
    credit_limit: 50_000_000,
  },
  {
    client_id: "c2",
    name: "Nestlé Cameroun",
    legal_name: "Nestlé Cameroun SA",
    is_active: true,
    credit_limit: 20_000_000,
  },
];
const ENTITIES = [
  {
    entity_id: "e1",
    code: "SBX",
    legal_name: "SmartBox SARL",
    name: "SmartBox",
    is_active: true,
  },
];

/**
 * The `/entities/:id/360` bundle the entity dossier renders from.
 *
 * `logo_light_ref` is set deliberately: the Overview tab's letterhead card draws
 * a `border-dashed` "No logo" placeholder when it is blank, and the register's
 * populated-state guard reads `.border-dashed` as "this screen is showing its
 * empty state". A fixture with a logo keeps that guard meaning what it says.
 */
const ENTITY_360 = {
  entity: {
    entity_id: "e1",
    code: "SBX",
    legal_name: "SmartBox SARL",
    trading_name: "SmartBox",
    legal_form: "SARL",
    country_code: "CM",
    registration_status: "ACTIVE",
    is_active: true,
    incorporation_date: "2019-04-02",
    incorporation_place: "Douala",
    incorporation_country: "CM",
    share_capital: 10_000_000,
    share_capital_paid_up: 10_000_000,
    share_capital_currency: "XAF",
    email: "contact@smartbox.cm",
    phone: "+237690000000",
    website: "https://smartbox.cm",
    industry: "Freight forwarding",
    headcount: 24,
    default_currency: "XAF",
    payroll_country: "CM",
    default_language: "fr",
    fiscal_year_start_month: 1,
    accounting_framework: "OHADA",
    doc_prefix: "SBX",
    numbering_reset: "ANNUAL",
    vat_registered: true,
    logo_light_ref: "/media/tenant/smartbox-light.png",
  },
  structure: {
    parent_entity_id: null,
    relationship_type: null,
    ownership_percent: null,
    consolidates: false,
    is_group_parent: true,
    ancestors: [],
    children: [],
  },
  people: [
    {
      person_id: "p1",
      role: "DIRECTOR",
      full_name: "Amina Ndoumbe",
      title: "Directrice Générale",
      effective_from: "2019-04-02",
    },
  ],
  contacts: [
    {
      contact_id: "ct1",
      name: "Comptabilité",
      email: "compta@smartbox.cm",
      is_primary: true,
    },
  ],
  addresses: [
    {
      address_id: "ad1",
      type: "REGISTERED",
      line1: "BP 1234",
      city: "Douala",
      country_code: "CM",
      is_primary: true,
    },
  ],
  registrations: [
    {
      registration_id: "rg1",
      country_code: "CM",
      kind: "NIU",
      number: "P0123456789A",
      is_primary: true,
    },
  ],
  establishments: [
    {
      establishment_id: "es1",
      name: "Siège social",
      kind: "HEAD_OFFICE",
      city: "Douala",
      country_code: "CM",
    },
  ],
  documents: [],
  tax_registrations: [],
  tax_obligations: [],
  treasury_accounts: [],
  treasury_is_read_only: true,
  cap_table: {
    as_of: "2026-07-01",
    holder_count: 1,
    total_percent: 100,
    total_shares: 1000,
    issued_capital: 10_000_000,
    balanced: true,
    findings: [],
  },
  usage: {
    journal_entries: 42,
    employees: 24,
    treasury_accounts: 1,
    subsidiaries: 0,
  },
  readiness: { ready: true, missing: [] },
  expiring_registrations: [],
  can_see_governance: true,
  letterhead_config: null,
  letterhead_source: {},
  letterhead_preview: {
    language: "fr",
    paper_size: "A4",
    logo_position: "LEFT",
    header: {},
    footer: {},
    payment_block: { source: "none", accounts: [] },
    identifiers: [],
    empty_blocks: [],
  },
  renewals: {
    as_of: "2026-07-01",
    items: [],
    counts: { expired: 0, due: 0, approaching: 0 },
  },
};
const USERS = [
  {
    user_id: "u1",
    full_name: "Amina Ndoumbe",
    email: "amina@example.test",
    is_active: true,
    roles: [],
  },
];

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
            {
              invoice_id: "i1",
              doc_number: "FIN-2026-0001",
              client_id: "c1",
              status: "ISSUED",
              total_ttc: 4_500_000,
              created_at: "2026-07-01",
            },
            {
              invoice_id: "i2",
              doc_number: null,
              client_id: "c2",
              status: "DRAFT",
              total_ttc: 1_250_000,
              created_at: "2026-07-14",
            },
          ],
          "/clients": CLIENTS,
        },
        populatedProof: /FIN-2026-0001/,
      },
      {
        name: "Chart of accounts",
        render: () => <ChartOfAccountsPage />,
        routes: {
          "/chart-of-accounts": [
            {
              account_id: "a1",
              account_code: "401000",
              name: "Fournisseurs",
              account_class: 4,
              is_active: true,
            },
          ],
        },
      },
      {
        name: "Journals",
        render: () => <JournalsPage />,
        routes: {
          "/journal-entries": [
            {
              entry_id: "j1",
              ref: "JRN-0001",
              entry_date: "2026-07-01",
              status: "POSTED",
              memo: "Opening",
            },
          ],
        },
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
          "/operations": [
            {
              operation_id: "o1",
              ref: "SBX-OPS-2026-0142",
              client_id: "c1",
              status: "IN_PROGRESS",
              service_key: "SEA_IMPORT",
            },
          ],
          "/clients": CLIENTS,
          "/service-types": [
            {
              service_type_id: "s1",
              service_key: "SEA_IMPORT",
              name: "Sea import",
            },
          ],
        },
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
          "/leads": [
            {
              lead_id: "l1",
              company_name: "Cimencam",
              contact_name: "Paul M.",
              status: "NEW",
              source: "WEBSITE",
              created_at: "2026-07-02",
            },
          ],
          "/intake": [],
        },
      },
      {
        name: "Meetings",
        render: () => <MeetingsPage />,
        routes: {
          "/meetings": [
            {
              meeting_id: "m1",
              subject: "Kick-off",
              scheduled_at: "2026-07-10T09:00:00Z",
              status: "SCHEDULED",
            },
          ],
          "/leads": [],
          "/clients": CLIENTS,
        },
      },
      {
        name: "Opportunities",
        render: () => <OpportunitiesPage />,
        routes: {
          "/opportunities/stages": [
            { pipeline_stage_id: "p1", name: "Qualified", sort_order: 1 },
          ],
          "/opportunities": [
            {
              opportunity_id: "op1",
              name: "Douala corridor",
              pipeline_stage_id: "p1",
              status: "OPEN",
              estimated_value: 12_000_000,
              probability: 40,
            },
          ],
          "/leads": [],
          "/clients": CLIENTS,
          "/entities": ENTITIES,
        },
      },
      {
        name: "Proposals",
        render: () => <ProposalsPage />,
        routes: {
          "/proposals": [
            {
              proposal_id: "pr1",
              title: "Corridor proposal",
              status: "DRAFT",
              total: 3_000_000,
            },
          ],
          "/leads": [],
          "/clients": CLIENTS,
          "/opportunities": [],
        },
      },
      {
        name: "Campaigns",
        render: () => <CampaignsPage />,
        routes: {
          "/campaigns": [
            {
              campaign_id: "ca1",
              name: "Q3 push",
              channel: "EMAIL",
              status: "DRAFT",
            },
          ],
          "/subscribers": [],
          "/templates": [],
          "/senders": [],
        },
      },
      {
        name: "Success stories",
        render: () => <SuccessStoriesPage />,
        routes: {
          "/success-stories": [
            { story_id: "st1", title: "Port turnaround", is_published: true },
          ],
        },
      },
    ],
  },
  {
    area: "Security",
    screens: [
      {
        name: "Users",
        render: () => <UsersPage />,
        routes: {
          "/users": USERS,
          "/roles": [{ role_id: "r1", name: "Ops", code: "OPS" }],
        },
      },
      {
        name: "Roles",
        render: () => <RolesPage />,
        routes: {
          "/roles": [
            {
              role_id: "r1",
              name: "Ops",
              code: "OPS",
              description: "Operations",
            },
          ],
        },
      },
      {
        name: "Capabilities",
        render: () => <CapabilitiesPage />,
        routes: {
          "/capabilities": [
            {
              capability_id: "cap1",
              code: "ops.read",
              description: "Read ops",
            },
          ],
        },
      },
      {
        name: "Field visibility",
        render: () => <FieldVisibilityPage />,
        routes: {
          "/field-visibility": [
            {
              id: "fv1",
              table_name: "clients",
              column_name: "credit_limit",
              visibility: "masked",
            },
          ],
          "/roles": [],
        },
      },
      {
        name: "Sessions",
        render: () => <SessionsPage />,
        routes: {
          "/sessions": [
            {
              session_id: "s1",
              user_id: "u1",
              created_at: "2026-07-01",
              ip: "10.0.0.1",
            },
          ],
        },
      },
    ],
  },
  {
    area: "Vault",
    screens: [
      {
        name: "Reports",
        render: () => <ReportsPage />,
        routes: {
          "/reports/catalogue": [
            {
              report_key: "ar_ageing",
              name: "AR ageing",
              describe: "Receivables by bucket",
            },
          ],
          "/reports/saved": [],
          "/reports/tiles": [],
        },
      },
      {
        name: "Compliance flags",
        render: () => <ComplianceFlagsPage />,
        routes: {
          "/compliance": [
            {
              flag_id: "f1",
              severity: "HIGH",
              status: "OPEN",
              describe: "Missing BL",
            },
          ],
          "/compliance/catalogue": [],
        },
      },
      {
        name: "Documents",
        render: () => <DocumentsPage />,
        routes: {
          "/documents": [
            {
              document_id: "d1",
              filename: "bl.pdf",
              entity_ref: "OPS-1",
              created_at: "2026-07-01",
            },
          ],
        },
      },
      {
        // Search-first: nothing is fetched until a document reference is typed,
        // so on arrival there is no request to be loading or to fail. Its
        // "empty" IS its initial state, which is the correct design for a lookup
        // screen and is why `states` narrows what this case asserts.
        name: "Signatures",
        render: () => <SignaturesPage />,
        routes: {
          "/signatures": [
            {
              signature_id: "sg1",
              entity_ref: "OPS-1",
              signer: "Amina",
              signed_at: "2026-07-02",
            },
          ],
        },
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
          "/quotations": [
            {
              quotation_id: "q1",
              ref: "QT-2026-001",
              client_id: "c1",
              status: "DRAFT",
              total: 8_000_000,
            },
          ],
          "/clients": CLIENTS,
          "/entities": ENTITIES,
          "/opportunities": [],
        },
      },
      {
        name: "Margin simulations",
        render: () => <MarginSimulationsPage />,
        routes: {
          "/margin-simulations": [
            { simulation_id: "ms1", name: "Corridor", margin_percent: 18 },
          ],
        },
      },
      {
        name: "Extra-charge simulations",
        render: () => <ExtraChargeSimulationsPage />,
        routes: {
          "/extra-charge-simulations": [
            { simulation_id: "es1", name: "Demurrage" },
          ],
        },
      },
      {
        name: "Pricing variance",
        render: () => <PricingVariancePage />,
        routes: {
          "/pricing-variance": [
            { variance_id: "v1", operation_id: "o1", delta: -120000 },
          ],
          "/operations": [],
          "/quotations": [],
        },
      },
    ],
  },
  {
    area: "Governance",
    screens: [
      {
        name: "Audit",
        render: () => <AuditPage />,
        routes: {
          "/audit": [
            {
              ledger_id: "al1",
              action: "UPDATE",
              table_name: "clients",
              actor_id: "u1",
              created_at: "2026-07-01",
            },
          ],
          "/users": USERS,
        },
      },
      {
        name: "Notifications",
        render: () => <NotificationsPage />,
        routes: {
          "/notifications": [
            {
              notification_id: "n1",
              title: "Approval needed",
              channel: "IN_APP",
              created_at: "2026-07-01",
            },
          ],
        },
      },
      {
        name: "Workflows",
        render: () => <WorkflowsPage />,
        routes: {
          "/workflows": [
            {
              workflow_id: "w1",
              name: "Invoice approval",
              event_type_key: "INVOICE_SUBMIT",
              step_count: 2,
              is_active: true,
            },
          ],
        },
      },
      {
        name: "Approvals",
        render: () => <ApprovalsPage />,
        routes: {
          "/approvals": [
            {
              task_id: "t1",
              step_kind: "APPROVE",
              status: "PENDING",
              entity_ref: "INV-1",
            },
          ],
        },
      },
    ],
  },
  {
    area: "Master data",
    screens: [
      {
        name: "Clients",
        render: () => <MasterClientsPage />,
        routes: { "/clients": CLIENTS, "/entities": ENTITIES },
      },
      {
        name: "Suppliers",
        render: () => <MasterSuppliersPage />,
        routes: {
          "/suppliers": [
            { supplier_id: "s1", name: "Total Energies", is_active: true },
          ],
          "/entities": ENTITIES,
        },
      },
      {
        name: "Corporate entities",
        render: () => <CorporateEntitiesPage />,
        // Master–detail: the list on the left, the dossier inline on the right.
        // The dossier is the half worth covering, so the fixture carries a whole
        // `/360` bundle rather than just the list — without it the screen renders
        // its error state and the pass would mean nothing.
        routes: { "/entities": ENTITIES, "/entities/e1/360": ENTITY_360 },
        populatedProof: /SmartBox SARL/,
      },
      {
        name: "Expense rates",
        render: () => <ExpenseRatesPage />,
        routes: {
          "/financial-dictionary": [
            {
              dictionary_item_id: "di1",
              code: "#R001",
              label_fr: "Frais de transit",
              label_en: "Transit fee",
              category: "service",
              direction: "REVENUE",
              applicability_mode: "ANY_OPERATIONS",
              currency: "XAF",
              is_active: true,
              varies_by_equipment: false,
              pricing_mode: "FLAT",
            },
          ],
          "/rate-providers": [
            {
              rate_provider_id: "rp1",
              kind: "SHIPPING_LINE",
              code: "MAERSK",
              name: "Maersk",
              is_active: true,
            },
          ],
          "/financial-dictionary/di1/rate-history": {
            item: {
              dictionary_item_id: "di1",
              code: "#R001",
              label_fr: "Frais de transit",
              label_en: "Transit fee",
              currency: "XAF",
              provider_kind: null,
            },
            series: [],
            trend: {
              first: null,
              last: null,
              delta: null,
              delta_pct: null,
              direction: "flat",
              points: 0,
            },
          },
        },
        populatedProof: /Transit fee/,
      },
      {
        name: "Financial dictionary",
        render: () => <FinancialDictionaryPage />,
        routes: {
          "/financial-dictionary": [
            {
              dictionary_item_id: "di1",
              code: "#R001",
              label_fr: "Frais de transit",
              label_en: "Transit fee",
              category: "service",
              direction: "REVENUE",
              applicability_mode: "ANY_OPERATIONS",
              is_active: true,
            },
          ],
          // PR2 tabs. The harness matches by LONGEST path prefix, so these must
          // be listed even though the dossier only fetches them when the tab is
          // selected — an unmocked path resolves to [] and the tab would render
          // its empty state instead of the tree the scan is meant to check.
          "/financial-dictionary/di1/spend": {
            item: {
              dictionary_item_id: "di1",
              code: "#R001",
              label_fr: "Frais de transit",
              label_en: "Transit fee",
              currency: "XAF",
              direction: "REVENUE",
            },
            period: { from: "2025-09-01", to: "2026-08-09", swapped: false },
            months: [
              {
                month: "2026-06",
                estimated: 120000,
                estimated_count: 1,
                committed: 100000,
                committed_count: 1,
                actual: 90000,
                actual_count: 2,
              },
              {
                month: "2026-07",
                estimated: 0,
                estimated_count: 0,
                committed: 0,
                committed_count: 0,
                actual: 0,
                actual_count: 0,
              },
              {
                month: "2026-08",
                estimated: 60000,
                estimated_count: 1,
                committed: 55000,
                committed_count: 1,
                actual: 50000,
                actual_count: 1,
              },
            ],
            totals: {
              estimated: 180000,
              committed: 155000,
              actual: 140000,
              estimated_count: 2,
              committed_count: 2,
              actual_count: 3,
              headline: 140000,
              variance_committed_actual: 15000,
              variance_estimated_actual: 40000,
            },
            documents: [
              {
                lens: "actual",
                doc_type: "cost_entry",
                doc_id: "ce1",
                doc_number: null,
                status: "validated",
                dossier_id: "d1",
                dossier_ref: "SBX-2026-0007",
                amount: 50000,
                currency: "XAF",
                doc_date: "2026-08-02",
                label: "Transit",
              },
              {
                lens: "committed",
                doc_type: "purchase_order",
                doc_id: "po1",
                doc_number: "PO-2026-001",
                status: "ISSUED_LOCKED",
                dossier_id: "d1",
                dossier_ref: "SBX-2026-0007",
                amount: 55000,
                currency: null,
                doc_date: "2026-08-01",
                label: "Transit fee",
              },
            ],
          },
          "/financial-dictionary/di1/rate-history": {
            item: {
              dictionary_item_id: "di1",
              code: "#R001",
              label_fr: "Frais de transit",
              label_en: "Transit fee",
              currency: "XAF",
              provider_kind: "PORT_TERMINAL",
            },
            series: [
              {
                key: "rp1|ct1",
                rate_provider_id: "rp1",
                provider_kind: "SHIPPING_LINE",
                provider_name: "MAERSK",
                container_type_ref_id: "ct1",
                container_type_code: "FT20",
                container_type_name: "20'",
                currency: "XAF",
                points: [
                  {
                    expense_rate_id: "er1",
                    rate: 100000,
                    currency: "XAF",
                    effective_from: "2026-01-01",
                    effective_to: "2026-05-31",
                    in_force: false,
                    superseded: true,
                    note: null,
                  },
                  {
                    expense_rate_id: "er2",
                    rate: 120000,
                    currency: "XAF",
                    effective_from: "2026-06-01",
                    effective_to: null,
                    in_force: true,
                    superseded: false,
                    note: "Annual review",
                  },
                ],
                current: {
                  expense_rate_id: "er2",
                  rate: 120000,
                  currency: "XAF",
                  effective_from: "2026-06-01",
                  effective_to: null,
                  in_force: true,
                  superseded: false,
                  note: "Annual review",
                },
                trend: {
                  first: 100000,
                  last: 120000,
                  delta: 20000,
                  delta_pct: 20,
                  direction: "up",
                  points: 2,
                },
              },
            ],
            trend: {
              first: 100000,
              last: 120000,
              delta: 20000,
              delta_pct: 20,
              direction: "up",
              points: 2,
            },
          },
          "/financial-dictionary/di1/360": {
            item: {
              dictionary_item_id: "di1",
              code: "#R001",
              label_fr: "Frais de transit",
              label_en: "Transit fee",
              category: "service",
              direction: "REVENUE",
              applicability_mode: "ANY_OPERATIONS",
              currency: "XAF",
              is_billable: true,
              is_active: true,
              receipt_requirement: "NOT_REQUIRED",
            },
            posting_rules: [
              {
                applies_context: "sale",
                debit_account: "4111",
                credit_account: "7061",
                debit_label: "Clients locaux",
                credit_label: "Commission de transit",
              },
            ],
            service_tiers: [],
            usage: {
              costing_lines: 0,
              cash_request_lines: 0,
              purchase_order_items: 0,
              invoice_lines: 0,
              supplier_invoice_lines: 0,
              cost_entries: 0,
              expense_rates: 0,
            },
            compliance: {
              requires_justification: false,
              receipt_requirement: "NOT_REQUIRED",
              proof_source: null,
              is_disbursement: false,
              disbursement_vat_transparent: true,
              needs_attention: false,
            },
          },
        },
        populatedProof: /Transit fee/,
      },
      {
        // Service types moved to Master Data as part of Option-B UI regrouping;
        // backend still rides MOD-29 (see service_type.events.js for why). The
        // populated state auto-selects the first row and loads its 360°, so the
        // fixture mocks BOTH the list and the 360 aggregate.
        name: "Service types",
        render: () => <ServiceTypesPage />,
        routes: {
          "/service-types": [
            {
              service_type_id: "s1",
              key: "SEA_IMPORT",
              name_fr: "Fret maritime import",
              name_en: "Sea import",
              is_active: true,
              has_active_template: true,
            },
          ],
          "/service-types/s1/360": {
            service_type: {
              service_type_id: "s1",
              key: "SEA_IMPORT",
              name_fr: "Fret maritime import",
              name_en: "Sea import",
              territory: "INTERNATIONAL_IMPORT",
              is_active: true,
              is_system: false,
              created_at: "2026-08-01T00:00:00Z",
            },
            stats: {
              dossiers_total: 4,
              dossiers_open: 1,
              dossiers_in_progress: 2,
              dossiers_completed: 1,
              dossiers_cancelled: 0,
              template_versions: 1,
              active_template_version: 1,
              dictionary_items: 3,
              margin_simulations: 2,
            },
            readiness: {
              has_active_template: true,
              active_template_version: 1,
              has_dictionary_line: true,
              ever_used: true,
              ever_billed: true,
            },
            templates: [
              {
                milestone_template_id: "t1",
                version: 1,
                is_active: true,
                created_at: "2026-08-02T00:00:00Z",
                stages: [
                  {
                    stage_id: "st1",
                    stage_seq: 1,
                    code: "BOOKING",
                    label_fr: "Réservation",
                    label_en: "Booking",
                    default_offset_days: 0,
                  },
                  {
                    stage_id: "st2",
                    stage_seq: 2,
                    code: "DEPARTURE",
                    label_fr: "Départ",
                    label_en: "Departure",
                    default_offset_days: 5,
                  },
                ],
              },
            ],
            dictionary_items: [
              // `tier` comes from the service_type_dictionary_item join (0630) and
              // renders as the pill in the scoped table's Tier column.
              {
                dictionary_item_id: "di1",
                code: "SEA_HANDLING",
                label_fr: "Manutention portuaire",
                label_en: "Port handling",
                category: "service",
                is_disbursement: false,
                is_billable: true,
                default_price: 150000,
                currency: "XAF",
                shipping_line: null,
                service_type_key: "SEA_IMPORT",
                tier: "BASIC",
                is_active: true,
              },
            ],
            dictionary_items_generic: [],
            dossiers: [
              {
                dossier_id: "d1",
                ref: "SBX-2026-0007",
                title: "Container CMAU1234567",
                status: "IN_PROGRESS",
                created_at: "2026-08-03T00:00:00Z",
                client_id: "c1",
                client_name: "Bolloré Logistics",
                billed_ttc: 850000,
                milestone_total: 5,
                milestone_done: 3,
                current_milestone: "Customs clearance",
              },
            ],
            dossiers_more: 3,
            margin_simulations: [
              {
                margin_simulation_id: "m1",
                dossier_id: "d1",
                dossier_ref: "SBX-2026-0007",
                currency: "XAF",
                margin_percent: 18.5,
                total_cost: 690000,
                total_price: 850000,
                created_at: "2026-08-04T00:00:00Z",
              },
            ],
            margin_simulations_more: 1,
            invoices: [],
            money: {
              planned: [
                {
                  currency: "XAF",
                  planned_total: 690000,
                  planned_disbursement: 200000,
                },
              ],
              billed: [
                {
                  currency: "XAF",
                  billed_ttc: 850000,
                  revenue_ht: 720339,
                  invoice_count: 1,
                },
              ],
              actual_total: 660000,
              masked: false,
            },
          },
        },
        // Populated state has data but the "invoices" sub-table is legitimately
        // empty in this fixture (finance visibility on, no invoice rows). The
        // dossier row and dictionary row prove data reached the screen.
        populatedProof: /SBX-2026-0007|SEA_HANDLING|Sea import/,
      },
    ],
  },
  {
    area: "Procurement",
    screens: [
      {
        name: "Purchase requests",
        render: () => <PurchaseRequestsPage />,
        routes: {
          "/purchase-requests": [
            {
              pr_id: "pr1",
              ref: "PR-2026-001",
              status: "DRAFT",
              justification: "Spares",
            },
          ],
        },
      },
      {
        name: "Purchase orders",
        render: () => <PurchaseOrdersPage />,
        routes: {
          "/purchase-orders": [
            { po_id: "po1", ref: "PO-2026-001", status: "OPEN" },
          ],
          "/suppliers": [],
        },
      },
      {
        name: "Goods received",
        render: () => <GoodsReceivedPage />,
        routes: {
          "/goods-received": [
            { grn_id: "g1", ref: "GRN-001", status: "RECEIVED" },
          ],
          "/purchase-orders": [],
        },
      },
      {
        name: "Supplier invoices",
        render: () => <SupplierInvoicesPage />,
        routes: {
          "/supplier-invoices": [
            {
              invoice_id: "si1",
              ref: "SI-001",
              status: "PENDING",
              amount: 900000,
            },
          ],
          "/suppliers": [],
        },
      },
    ],
  },
  {
    area: "Settings",
    screens: [
      {
        name: "Bank accounts",
        render: () => <BankAccountsPage />,
        routes: {
          "/treasury-accounts": [
            {
              account_id: "b1",
              label: "SGC main",
              bank_name: "SGC",
              currency: "XAF",
            },
          ],
          "/entities": ENTITIES,
        },
      },
      {
        name: "Payment gateways",
        render: () => <PaymentGatewaysPage />,
        routes: {
          "/payment-gateways": [
            { gateway_id: "g1", provider: "MTN", is_active: true },
          ],
        },
      },
      {
        name: "Scheduled reports",
        render: () => <ScheduledReportsPage />,
        routes: {
          "/reports/scheduled": [
            { schedule_id: "s1", report_key: "ar_ageing", cadence: "weekly" },
          ],
          "/reports/catalogue": [],
        },
      },
      {
        name: "API keys",
        render: () => <ApiKeysPage />,
        routes: {
          "/settings/integration_secret": [
            { key: "exchangerate", last4: "9f2a" },
          ],
        },
      },
      {
        name: "Pipeline stages",
        render: () => <PipelineStagesPage />,
        routes: {
          "/opportunities/stages": [
            { pipeline_stage_id: "p1", name: "Qualified", sort_order: 1 },
          ],
        },
      },
      {
        name: "Custom fields",
        render: () => <CustomFieldsPage />,
        routes: { "/settings": [] },
      },
      {
        name: "Email signatures",
        render: () => <EmailSignaturesPage />,
        routes: { "/settings": [] },
      },
      {
        name: "Business policies",
        render: () => <BusinessPoliciesPage />,
        routes: { "/settings": [] },
      },
      {
        name: "Currencies",
        render: () => <CurrenciesPage />,
        routes: {
          "/currencies": [{ code: "XAF", name: "CFA franc", rate: 1 }],
        },
      },
      {
        name: "Tax jurisdictions",
        render: () => <TaxJurisdictionsPage />,
        routes: {
          "/tax-jurisdictions": [
            {
              jurisdiction_id: "tj1",
              country_code: "CM",
              name: "Cameroon",
              currency: "XAF",
              is_active: true,
            },
          ],
        },
      },
    ],
  },
  {
    area: "AI control",
    screens: [
      {
        name: "AI vendors",
        render: () => <aiControl.AiVendorsPage />,
        routes: {
          "/ai": [
            {
              vendor: "anthropic",
              current_model: "claude",
              has_key: true,
              is_active: true,
            },
          ],
        },
      },
      {
        name: "AI features",
        render: () => <aiControl.AiFeaturesPage />,
        routes: { "/ai": [{ feature_key: "summarise", is_enabled: true }] },
      },
    ],
  },
  {
    area: "Costing",
    screens: [
      {
        name: "Costing",
        render: () => <costing.CostingPage />,
        routes: {
          "/costings": [
            {
              costing_id: "co1",
              ref: "CST-001",
              status: "DRAFT",
              total: 5_000_000,
            },
          ],
          "/operations": [],
        },
      },
    ],
  },
  {
    area: "WMS",
    screens: [
      {
        name: "Cycle counts",
        render: () => <CycleCountsPage />,
        routes: {
          "/cycle-counts": [
            {
              cycle_count_id: "cc1",
              ref: "CC-001",
              status: "OPEN",
              location_id: "loc1",
            },
          ],
          "/warehouse-locations": [],
        },
      },
      {
        name: "Equipment",
        render: () => <EquipmentPage />,
        routes: {
          "/equipment": [
            {
              equipment_id: "eq1",
              code: "FL-01",
              kind: "FORKLIFT",
              is_active: true,
            },
          ],
        },
      },
      {
        name: "Inbound",
        render: () => <InboundPage />,
        routes: {
          "/inbound": [
            {
              grn_inbound_id: "aaaaaaaa-1111",
              qa_status: "HOLD",
              putaway_location: "A-01",
              created_at: "2026-07-01",
            },
          ],
        },
        populatedProof: /aaaaaaaa/,
      },
      {
        name: "Inventory",
        render: () => <InventoryPage />,
        routes: {
          "/inventory": [
            {
              inventory_item_id: "it1",
              sku: "SKU-1",
              description: "Pallet",
              qty_on_hand: 12,
            },
          ],
        },
      },
      {
        name: "Outbound",
        render: () => <OutboundPage />,
        routes: {
          "/outbound": [
            {
              outbound_order_id: "bbbbbbbb-2222",
              status: "PICKING",
              created_at: "2026-07-01",
            },
          ],
        },
        populatedProof: /bbbbbbbb/,
      },
    ],
  },
  {
    area: "Fleet",
    screens: [
      {
        name: "Compliance",
        render: () => <VehicleCompliancePage />,
        routes: {
          "/vehicle-compliance": [
            {
              compliance_id: "vc1",
              vehicle_id: "v1",
              registration: "LT-1234-AB",
              kind: "INSURANCE",
              expires_on: "2026-12-31",
            },
          ],
          "/vehicles": [],
        },
      },
      {
        name: "Dispatch",
        render: () => <DispatchPage />,
        routes: {
          "/dispatch": [
            {
              fleet_dispatch_id: "cccccccc-3333",
              registration: "LT-1234-AB",
              driver_name: "Jean K.",
              status: "ASSIGNED",
            },
          ],
          "/vehicles": [],
          "/drivers": [],
        },
        populatedProof: /LT-1234-AB/,
      },
      {
        name: "Drivers",
        render: () => <DriversPage />,
        routes: {
          "/drivers": [
            {
              driver_id: "dr1",
              full_name: "Jean K.",
              licence_no: "CM-001",
              is_active: true,
            },
          ],
        },
      },
      {
        name: "Fuel log",
        render: () => <FuelLogPage />,
        routes: {
          "/fuel": [
            {
              fuel_log_id: "f1",
              vehicle_id: "v1",
              litres: 60,
              cost: 45000,
              logged_on: "2026-07-01",
            },
          ],
          "/vehicles": [],
        },
      },
      {
        name: "Incidents",
        render: () => <IncidentsPage />,
        routes: {
          "/incidents": [
            {
              incident_id: "i1",
              ref: "INC-001",
              severity: "LOW",
              status: "OPEN",
            },
          ],
          "/vehicles": [],
        },
      },
      {
        name: "Work orders",
        render: () => <WorkOrdersPage />,
        routes: {
          "/work-orders": [
            { work_order_id: "w1", ref: "WO-001", status: "OPEN" },
          ],
          "/vehicles": [],
        },
      },
    ],
  },
  {
    area: "HR",
    screens: [
      {
        name: "SOPs",
        render: () => <SopsPage />,
        routes: {
          "/sops": [
            {
              sop_document_id: "s1",
              title: "Cargo handling",
              category: "Ops",
              version_no: 2,
              is_active: true,
            },
          ],
          "/onboarding": [],
          "/employees": [],
        },
      },
      // `/vacancies/talent-pool` is the Past applicants panel (0525) — everyone
      // who applied and was not hired, across every vacancy. It is a SECOND
      // source on this screen: `/talent-pool` is the hand-entered bench, and the
      // two are deliberately not merged. Without a fixture the panel renders its
      // empty state and the populated-state assertion fails on the screen as a
      // whole, which is the harness correctly noticing a fetch it was not told
      // about.
      {
        name: "Talent pool",
        render: () => <TalentPoolPage />,
        routes: {
          "/talent-pool": [
            { talent_pool_id: "t1", full_name: "Marie N.", skills: "Customs" },
          ],
          "/vacancies/talent-pool": [
            {
              applicant_id: "a1",
              vacancy_id: "v1",
              full_name: "Paul K.",
              status: "TALENT_POOL",
              skills: ["Customs", "French"],
              vacancy_title: "Declarant",
              ai_score: 82,
              ai_provisional: false,
              applied_at: "2026-06-02",
            },
          ],
          "/succession": [
            {
              succession_id: "sc1",
              role_title: "Head of Ops",
              employee_id: "e1",
              readiness: "ready_now",
            },
          ],
          "/employees": [{ employee_id: "e1", full_name: "Marie N." }],
        },
        populatedProof: /Marie N\./,
      },
    ],
  },
  {
    area: "Support & admin",
    screens: [
      {
        name: "Support",
        render: () => <SupportPage />,
        routes: {
          "/support": [
            {
              ticket_id: "t1",
              title: "Cannot post journal",
              status: "OPEN",
              created_at: "2026-07-01",
            },
          ],
        },
      },
      {
        // Static content: zero network calls, so there is no loading or error
        // state for this screen to be missing. Verified by reading it, not
        // assumed — `grep -c "useList\|useResource\|tenant("` returns 0.
        name: "Help",
        render: () => <HelpPage />,
        routes: {},
        states: ["populated"],
      },
      {
        name: "God mode",
        render: () => <GodModePage />,
        routes: {
          "/god-mode/soft-deletes": [
            {
              soft_delete_id: "g1",
              table_name: "clients",
              deleted_at: "2026-07-01",
              is_accounting_connected: false,
            },
          ],
        },
      },
    ],
  },
];

/* ── the gate ─────────────────────────────────────────────────────────────── */

const CASES = AREAS.flatMap((a) =>
  a.screens.map((s) => ({ ...s, area: a.area })),
);

describe.each(CASES)(
  "$area › $name",
  ({ render: renderCase, routes, populatedProof, states, rendersRows }) => {
    const has = (s: string) => !states || states.includes(s as never);

    it.runIf(has("loading"))(
      "loading state is clean and announced",
      async () => {
        const { container } = renderScreen(renderCase(), { pending: true });
        // F10: skeletons carry role="status" so the wait is announced rather than
        // being a silent blank region.
        expect(
          container.querySelector('[role="status"], [aria-busy="true"]'),
        ).toBeTruthy();
        expect(await axe(container)).toHaveNoViolations();
      },
    );

    it.runIf(has("error"))(
      "error state is clean and says what went wrong",
      async () => {
        const f: ScreenFixtures = {
          routes: Object.fromEntries(
            Object.keys(routes ?? {}).map((k) => [
              k,
              apiError(403, "You don't have permission to view this."),
            ]),
          ),
        };
        const { container } = renderScreen(renderCase(), f);
        await waitFor(() =>
          expect(container.textContent).toMatch(
            /permission|failed|unable|error|wrong/i,
          ),
        );
        // Addendum 6 defect 4: a 403 must NOT resolve into a reassuring empty state.
        expect(container.textContent).not.toMatch(/all clear/i);
        expect(await axe(container)).toHaveNoViolations();
      },
    );

    it("empty state is clean and is not the developer default", async () => {
      const f: ScreenFixtures = {
        routes: Object.fromEntries(
          Object.keys(routes ?? {}).map((k) => [k, []]),
        ),
      };
      const { container } = renderScreen(renderCase(), f);
      await waitFor(() =>
        expect(container.querySelector('[aria-busy="true"]')).toBeFalsy(),
      );
      // F11: "No records returned." is the fallback nobody should be shipping.
      expect(container.textContent).not.toMatch(/No records returned\./);
      expect(await axe(container)).toHaveNoViolations();
    });

    it("populated state is clean, with exactly one h1", async () => {
      const { container } = renderScreen(renderCase(), { routes });
      if (populatedProof)
        await waitFor(() =>
          expect(container.textContent).toMatch(populatedProof),
        );

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
      const suppliedRows = Object.values(routes ?? {}).some(
        (v) => Array.isArray(v) && v.length > 0,
      );
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
  },
);

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
  const paths = {
    "/reports/catalogue": null,
    "/reports/saved": null,
    "/reports/tiles": null,
  };

  it("a missing GRANT reports a permission problem, not a feature flag", async () => {
    const routes = Object.fromEntries(
      Object.keys(paths).map((k) => [
        k,
        apiError(403, "You don't have permission to do this.", "FORBIDDEN"),
      ]),
    );
    const { container } = renderScreen(<ReportsPage />, { routes });
    await waitFor(() => expect(container.textContent).toMatch(/permission/i));
    expect(container.textContent).not.toMatch(/isn't enabled|feature flag/i);
  });

  it("a genuinely disabled FEATURE still says so, and names the remedy", async () => {
    const routes = Object.fromEntries(
      Object.keys(paths).map((k) => [
        k,
        apiError(
          403,
          "Feature 'reports' is off for this tenant",
          "FEATURE_DISABLED",
        ),
      ]),
    );
    const { container } = renderScreen(<ReportsPage />, { routes });
    await waitFor(() =>
      expect(container.textContent).toMatch(/isn't enabled/i),
    );
    expect(container.textContent).toMatch(/developer dashboard/i);
  });
});
