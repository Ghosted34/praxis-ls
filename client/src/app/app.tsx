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
import { AuditPage, NotificationsPage, WorkflowsPage, ApprovalsPage } from "@/features/governance/pages";
import { AppearancePage } from "@/features/settings/appearance-page";
import { SettingsHub } from "@/features/settings/settings-hub";
import { LoginEditor } from "@/features/settings/login-editor";
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
  ProformasPage,
  ReceivablesPage,
  ChartOfAccountsPage,
  StatementsPage,
  TaxCenterPage,
} from "@/features/finance/pages";
import { ComingSoon } from "@/features/placeholder/coming-soon";
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
        <Route path="workspace" element={<ComingSoon />} />
        <Route path="godmode" element={<ComingSoon />} />
        {/* Commercial */}
        <Route path="commercial/quotations" element={<ComingSoon />} />
        <Route path="commercial/margin-simulation" element={<ComingSoon />} />
        <Route path="commercial/extra-charge-simulation" element={<ComingSoon />} />
        <Route path="commercial/pricing-variance" element={<ComingSoon />} />
        {/* Sales / CRM */}
        <Route path="sales/leads" element={<ComingSoon />} />
        <Route path="sales/inbound-intake" element={<ComingSoon />} />
        <Route path="sales/opportunities" element={<ComingSoon />} />
        <Route path="sales/proposals" element={<ComingSoon />} />
        <Route path="sales/meetings" element={<ComingSoon />} />
        <Route path="sales/campaigns" element={<ComingSoon />} />
        <Route path="sales/success-stories" element={<ComingSoon />} />
        {/* Operations */}
        <Route path="operations/files" element={<ComingSoon />} />
        <Route path="operations/milestones" element={<ComingSoon />} />
        <Route path="operations/transit-orders" element={<ComingSoon />} />
        <Route path="operations/delivery-notes" element={<ComingSoon />} />
        {/* Procurement */}
        <Route path="procurement/purchase-requests" element={<ComingSoon />} />
        <Route path="procurement/purchase-orders" element={<ComingSoon />} />
        <Route path="procurement/goods-received" element={<ComingSoon />} />
        <Route path="procurement/supplier-invoices" element={<ComingSoon />} />
        {/* Costing */}
        <Route path="costing/costing" element={<ComingSoon />} />
        <Route path="costing/cost-tracking" element={<ComingSoon />} />
        <Route path="costing/cash-requests" element={<ComingSoon />} />
        <Route path="costing/regie" element={<ComingSoon />} />
        {/* Finance (new) */}
        <Route path="finance/debt" element={<ComingSoon />} />
        {/* Master data */}
        <Route path="master/clients" element={<ComingSoon />} />
        <Route path="master/suppliers" element={<ComingSoon />} />
        <Route path="master/corporate-entities" element={<ComingSoon />} />
        <Route path="master/treasury-accounts" element={<ComingSoon />} />
        <Route path="master/currencies" element={<ComingSoon />} />
        <Route path="master/expense-rates" element={<ComingSoon />} />
        <Route path="master/financial-dictionary" element={<ComingSoon />} />
        <Route path="master/tax-jurisdictions" element={<ComingSoon />} />
        {/* Vault */}
        <Route path="vault/documents" element={<ComingSoon />} />
        <Route path="vault/signatures" element={<ComingSoon />} />
        <Route path="vault/verification" element={<ComingSoon />} />
        <Route path="vault/compliance-flags" element={<ComingSoon />} />
        <Route path="vault/reports" element={<ComingSoon />} />
        {/* Comms */}
        <Route path="comms" element={<ComingSoon />} />
        {/* Settings & Admin (new) */}
        <Route path="settings/numbering" element={<ComingSoon />} />
        <Route path="settings/catalogue" element={<ComingSoon />} />
        <Route path="portal/access" element={<ComingSoon />} />
        {/* Settings hub cards without a dedicated editor yet */}
        <Route path="settings/business-setup" element={<ComingSoon />} />
        <Route path="settings/businesses" element={<ComingSoon />} />
        <Route path="settings/login" element={<LoginEditor />} />
        <Route path="settings/business-policies" element={<ComingSoon />} />
        <Route path="settings/payment-gateways" element={<ComingSoon />} />
        <Route path="settings/custom-fields" element={<ComingSoon />} />
        <Route path="settings/pipeline-stages" element={<ComingSoon />} />
        <Route path="settings/scheduled-reports" element={<ComingSoon />} />
        <Route path="settings/factory-languages" element={<ComingSoon />} />
        <Route path="settings/document-templates" element={<ComingSoon />} />
        <Route path="settings/email-signatures" element={<ComingSoon />} />
        <Route path="settings/api-keys" element={<ComingSoon />} />
        <Route path="settings/help-center" element={<ComingSoon />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BootGate>
  );
}
