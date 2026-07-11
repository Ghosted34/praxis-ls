import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth } from "@/app/auth/require-auth";
import { AppShell } from "@/app/layout/app-shell";
import { LoginPage } from "@/features/auth/login-page";
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
import { AuditPage, NotificationsPage, WorkflowsPage, ApprovalsPage, SettingsPage } from "@/features/governance/pages";
import { AppearancePage } from "@/features/settings/appearance-page";
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
  VacanciesPage,
  ContractsPage,
  AppraisalsPage,
  AttendancePage,
  LeavePage,
  SopsPage,
  TrainingsPage,
  TalentPoolPage,
} from "@/features/hr/pages";
import { BootGate } from "@/app/boot-gate";

export function App() {
  return (
    <BootGate>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

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
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BootGate>
  );
}
