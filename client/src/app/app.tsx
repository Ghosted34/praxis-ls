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
