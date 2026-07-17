import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth } from "@/app/auth/require-auth";
import { AppShell } from "@/app/layout/app-shell";
import { LandingPage } from "@/features/landing/landing-page";
import { DashboardPage } from "@/features/dashboard";
import {
  UsersPage,
  RolesPage,
  CapabilitiesPage,
  ScopesPage,
  FieldVisibilityPage,
  SessionsPage,
} from "@/features/security/pages";
import { PermissionMatrixPage } from "@/features/security/permission-matrix-page";
import { MySecurityPage } from "@/features/security/my-security";
import { AuditPage, NotificationsPage, WorkflowsPage, ApprovalsPage } from "@/features/governance/pages";
import { AppearancePage } from "@/features/settings/appearance-page";
import { SettingsHub } from "@/features/settings/settings-hub";
import { LoginEditor } from "@/features/settings/login-editor";
import { CurrenciesPage, TaxJurisdictionsPage } from "@/features/settings/master-data-pages";
import {
  BankAccountsPage,
  PaymentGatewaysPage,
  ScheduledReportsPage,
  ApiKeysPage,
  PipelineStagesPage,
  NumberingPage,
} from "@/features/settings/config-pages";
import {
  VehiclesPage,
  VehicleCompliancePage,
  WorkOrdersPage,
  DispatchPage,
  FuelLogPage,
  DriversPage,
  IncidentsPage,
} from "@/features/fleet/pages";
import {
  LocationsPage,
  InventoryPage,
  InboundPage,
  OutboundPage,
  EquipmentPage,
  CycleCountsPage,
} from "@/features/wms/pages";
import {
  EmployeesPage,
  PayrollPage,
  VacanciesPage,
  ContractsPage,
  AppraisalsPage,
  AttendancePage,
  LeavePage,
  SopsPage,
  TrainingsPage,
  TalentPoolPage,
} from "@/features/hr/pages";
import {
  AssetsPage,
  JournalsPage,
  InvoicesPage,
  CreditNotesPage,
  ProformasPage,
  ReceivablesPage,
  ChartOfAccountsPage,
  StatementsPage,
  TaxCenterPage,
} from "@/features/finance/pages";
import { ClientsPage, SuppliersPage, CorporateEntitiesPage } from "@/features/master/pages";
import { LeadsPage, MeetingsPage, OpportunitiesPage, ProposalsPage, CampaignsPage, SuccessStoriesPage } from "@/features/sales/pages";
import { QuotationsPage, MarginSimulationsPage, ExtraChargeSimulationsPage, PricingVariancePage } from "@/features/commercial/pages";
import { ReportsPage, ComplianceFlagsPage } from "@/features/vault/pages";
import { PortalAccessPage } from "@/features/portal/pages";
import { Planned } from "@/features/scaffold/screen-scaffold";
import { BootGate } from "@/app/boot-gate";

export function App() {
  return (
    <BootGate>
      <Routes>
        <Route path="/login" element={<LandingPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="security/users" element={<UsersPage />} />
        <Route path="security/roles" element={<RolesPage />} />
        <Route path="security/permissions" element={<PermissionMatrixPage />} />
        <Route path="security/capabilities" element={<CapabilitiesPage />} />
        <Route path="security/scopes" element={<ScopesPage />} />
        <Route path="security/field-visibility" element={<FieldVisibilityPage />} />
        <Route path="security/sessions" element={<SessionsPage />} />
        <Route path="security/my-security" element={<MySecurityPage />} />
        <Route path="fleet/vehicles" element={<VehiclesPage />} />
        <Route path="fleet/compliance" element={<VehicleCompliancePage />} />
        <Route path="fleet/work-orders" element={<WorkOrdersPage />} />
        <Route path="fleet/dispatch" element={<DispatchPage />} />
        <Route path="fleet/fuel" element={<FuelLogPage />} />
        <Route path="fleet/drivers" element={<DriversPage />} />
        <Route path="fleet/incidents" element={<IncidentsPage />} />
        <Route path="wms/locations" element={<LocationsPage />} />
        <Route path="wms/inventory" element={<InventoryPage />} />
        <Route path="wms/inbound" element={<InboundPage />} />
        <Route path="wms/outbound" element={<OutboundPage />} />
        <Route path="wms/equipment" element={<EquipmentPage />} />
        <Route path="wms/cycle-counts" element={<CycleCountsPage />} />
        <Route path="hr/employees" element={<EmployeesPage />} />
        <Route path="hr/payroll" element={<PayrollPage />} />
        <Route path="finance/chart-of-accounts" element={<ChartOfAccountsPage />} />
        <Route path="finance/journals" element={<JournalsPage />} />
        <Route path="finance/proformas" element={<ProformasPage />} />
        <Route path="finance/invoices" element={<InvoicesPage />} />
        <Route path="finance/credit-notes" element={<CreditNotesPage />} />
        <Route path="finance/receivables" element={<ReceivablesPage />} />
        <Route path="finance/statements" element={<StatementsPage />} />
        <Route path="finance/tax" element={<TaxCenterPage />} />
        <Route path="finance/assets" element={<AssetsPage />} />
        <Route path="hr/vacancies" element={<VacanciesPage />} />
        <Route path="hr/contracts" element={<ContractsPage />} />
        <Route path="hr/appraisals" element={<AppraisalsPage />} />
        <Route path="hr/attendance" element={<AttendancePage />} />
        <Route path="hr/leave" element={<LeavePage />} />
        <Route path="hr/sops" element={<SopsPage />} />
        <Route path="hr/trainings" element={<TrainingsPage />} />
        <Route path="hr/talent-pool" element={<TalentPoolPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="workflows" element={<WorkflowsPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="appearance" element={<AppearancePage />} />
        <Route path="settings" element={<SettingsHub />} />

        {/* --- IA-map screens not yet built → shared placeholder (see doc/FE_IA_HANDOFF.md) --- */}
        {/* Overview */}
        <Route path="workspace" element={<Planned />} />
        <Route path="godmode" element={<Planned />} />
        {/* Commercial */}
        <Route path="commercial/quotations" element={<QuotationsPage />} />
        <Route path="commercial/margin-simulation" element={<MarginSimulationsPage />} />
        <Route path="commercial/extra-charge-simulation" element={<ExtraChargeSimulationsPage />} />
        <Route path="commercial/pricing-variance" element={<PricingVariancePage />} />
        {/* Sales / CRM — Leads folds in Inbound intake as a tab (intake route redirects) */}
        <Route path="sales/leads" element={<LeadsPage />} />
        <Route path="sales/inbound-intake" element={<Navigate to="/sales/leads?tab=intake" replace />} />
        <Route path="sales/opportunities" element={<OpportunitiesPage />} />
        <Route path="sales/proposals" element={<ProposalsPage />} />
        <Route path="sales/meetings" element={<MeetingsPage />} />
        <Route path="sales/campaigns" element={<CampaignsPage />} />
        <Route path="sales/success-stories" element={<SuccessStoriesPage />} />
        {/* Operations */}
        <Route path="operations/files" element={<Planned />} />
        <Route path="operations/milestones" element={<Planned />} />
        <Route path="operations/transit-orders" element={<Planned />} />
        <Route path="operations/delivery-notes" element={<Planned />} />
        {/* Procurement */}
        <Route path="procurement/purchase-requests" element={<Planned />} />
        <Route path="procurement/purchase-orders" element={<Planned />} />
        <Route path="procurement/goods-received" element={<Planned />} />
        <Route path="procurement/supplier-invoices" element={<Planned />} />
        {/* Costing */}
        <Route path="costing/costing" element={<Planned />} />
        <Route path="costing/cost-tracking" element={<Planned />} />
        <Route path="costing/cash-requests" element={<Planned />} />
        <Route path="costing/regie" element={<Planned />} />
        {/* Finance (new) */}
        <Route path="finance/debt" element={<Planned />} />
        {/* Master data */}
        <Route path="master/clients" element={<ClientsPage />} />
        <Route path="master/suppliers" element={<SuppliersPage />} />
        <Route path="master/corporate-entities" element={<CorporateEntitiesPage />} />
        <Route path="master/treasury-accounts" element={<BankAccountsPage />} />
        <Route path="master/currencies" element={<CurrenciesPage />} />
        <Route path="master/expense-rates" element={<Planned />} />
        <Route path="master/financial-dictionary" element={<Planned />} />
        <Route path="master/tax-jurisdictions" element={<TaxJurisdictionsPage />} />
        {/* Vault */}
        <Route path="vault/documents" element={<Planned />} />
        <Route path="vault/signatures" element={<Planned />} />
        <Route path="vault/verification" element={<Planned />} />
        <Route path="vault/compliance-flags" element={<ComplianceFlagsPage />} />
        <Route path="vault/reports" element={<ReportsPage />} />
        {/* Comms */}
        <Route path="comms" element={<Planned />} />
        {/* Settings & Admin (new) */}
        <Route path="settings/numbering" element={<NumberingPage />} />
        <Route path="settings/catalogue" element={<Planned />} />
        <Route path="portal/access" element={<PortalAccessPage />} />
        {/* Settings hub cards without a dedicated editor yet */}
        <Route path="settings/business-setup" element={<Planned />} />
        <Route path="settings/login" element={<LoginEditor />} />
        <Route path="settings/business-policies" element={<Planned />} />
        <Route path="settings/payment-gateways" element={<PaymentGatewaysPage />} />
        <Route path="settings/custom-fields" element={<Planned />} />
        <Route path="settings/pipeline-stages" element={<PipelineStagesPage />} />
        <Route path="settings/scheduled-reports" element={<ScheduledReportsPage />} />
        <Route path="settings/factory-languages" element={<Planned />} />
        <Route path="settings/document-templates" element={<Planned />} />
        <Route path="settings/email-signatures" element={<Planned />} />
        <Route path="settings/api-keys" element={<ApiKeysPage />} />
        <Route path="settings/help-center" element={<Planned />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BootGate>
  );
}
