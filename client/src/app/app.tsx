import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth } from "@/app/auth/require-auth";
import { AppShell } from "@/app/layout/app-shell";
import { LandingPage } from "@/features/landing/landing-page";
import { DashboardPage } from "@/features/dashboard";
import { SecurityHub } from "@/features/security/hub";
import { AuditPage, NotificationsPage, WorkflowsPage, ApprovalsPage } from "@/features/governance/pages";
import { AppearancePage } from "@/features/settings/appearance-page";
import { SettingsHub } from "@/features/settings/settings-hub";
import { LoginEditor } from "@/features/settings/login-editor";
import {
  PaymentGatewaysPage,
  ScheduledReportsPage,
  ApiKeysPage,
  PipelineStagesPage,
  NumberingPage,
} from "@/features/settings/config-pages";
import { DocumentTemplatesPage, CustomFieldsPage, EmailSignaturesPage, BusinessPoliciesPage } from "@/features/settings/store-pages";
import { ModuleCataloguePage } from "@/features/settings/catalogue-page";
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
import { FinanceHub } from "@/features/finance/hub";
import { Planned } from "@/features/scaffold/screen-scaffold";
import { LeadsPage, MeetingsPage, OpportunitiesPage, ProposalsPage, CampaignsPage, SuccessStoriesPage } from "@/features/sales/pages";
import { QuotationsPage, MarginSimulationsPage, ExtraChargeSimulationsPage, PricingVariancePage } from "@/features/commercial/pages";
import { VaultHub } from "@/features/vault/hub";
import { PortalAccessPage } from "@/features/portal/pages";
import { WorkspacePage } from "@/features/workspace/workspace-page";
import { MasterDataPage } from "@/features/masterdata/master-data-page";
import { OperationsHub } from "@/features/operations/hub";
import { CostingHub } from "@/features/costing/hub";
import { ProcurementHub } from "@/features/procurement/hub";
import { AiControlHub } from "@/features/ai-control/hub";
import { GodModePage } from "@/features/godmode/godmode-page";
import { CommsHub } from "@/features/comms/hub";
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
        {/* Security & access — one hub; the old per-screen paths resolve as its
            sections, so nav entries, bookmarks and ⌘K hits keep working. */}
        <Route path="security" element={<SecurityHub />} />
        <Route path="security/:section" element={<SecurityHub />} />
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
        {/* Finance — one hub, deep-linkable tabs (per-section routes still resolve) */}
        <Route path="finance" element={<FinanceHub />} />
        <Route path="finance/:section" element={<FinanceHub />} />
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
        <Route path="workspace" element={<WorkspacePage />} />
        <Route path="godmode" element={<GodModePage />} />
        {/* AI Control — governance admin hub */}
        <Route path="ai-control" element={<AiControlHub />} />
        <Route path="ai-control/:section" element={<AiControlHub />} />
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
        {/* Operations — hub */}
        <Route path="operations" element={<OperationsHub />} />
        <Route path="operations/:section" element={<OperationsHub />} />
        {/* Procurement — hub */}
        <Route path="procurement" element={<ProcurementHub />} />
        <Route path="procurement/:section" element={<ProcurementHub />} />
        {/* Costing — hub */}
        <Route path="costing" element={<CostingHub />} />
        <Route path="costing/:section" element={<CostingHub />} />
        {/* Finance (new) */}
        {/* Master data — one hub, deep-linkable tabs (per-section routes still resolve) */}
        <Route path="master" element={<MasterDataPage />} />
        <Route path="master/:section" element={<MasterDataPage />} />
        {/* Vault */}
        {/* Vault & compliance — same shape as Security: one hub, old paths become sections. */}
        <Route path="vault" element={<VaultHub />} />
        <Route path="vault/:section" element={<VaultHub />} />
        {/* Comms — Smart Comms hub */}
        <Route path="comms" element={<CommsHub />} />
        <Route path="comms/:section" element={<CommsHub />} />
        {/* Settings & Admin (new) */}
        <Route path="settings/numbering" element={<NumberingPage />} />
        <Route path="settings/catalogue" element={<ModuleCataloguePage />} />
        <Route path="portal/access" element={<PortalAccessPage />} />
        {/* Settings hub cards without a dedicated editor yet */}
        {/* Business setup was a duplicate of the Corporate entities editor (MOD-01) —
            same profile / financial identity / fiscal-year fields. Retired 2026-07-18;
            the missing bits (address, bank block, letterhead logo) were folded into
            that editor instead. Redirect keeps old links + the Settings hub card working. */}
        <Route path="settings/business-setup" element={<Navigate to="/master/corporate-entities" replace />} />
        <Route path="settings/login" element={<LoginEditor />} />
        <Route path="settings/business-policies" element={<BusinessPoliciesPage />} />
        <Route path="settings/payment-gateways" element={<PaymentGatewaysPage />} />
        <Route path="settings/custom-fields" element={<CustomFieldsPage />} />
        <Route path="settings/pipeline-stages" element={<PipelineStagesPage />} />
        <Route path="settings/scheduled-reports" element={<ScheduledReportsPage />} />
        <Route path="settings/api-keys" element={<ApiKeysPage />} />
        <Route path="settings/factory-languages" element={<Planned />} />
        <Route path="settings/document-templates" element={<DocumentTemplatesPage />} />
        <Route path="settings/email-signatures" element={<EmailSignaturesPage />} />
        {/* No BE yet — scaffolded like factory-languages. The Settings hub still
            links here (settings-hub.tsx), so without this route the card dead-ends
            on the catch-all redirect. */}
        <Route path="settings/help-center" element={<Planned />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BootGate>
  );
}