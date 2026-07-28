import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth } from "@/app/auth/require-auth";
import { AppShell } from "@/app/layout/app-shell";
import { LandingPage } from "@/features/landing/landing-page";
import { ResetPasswordPage } from "@/features/auth/reset-password-page";
import { HelpPage } from "@/features/help/help-page";
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
import { CustomFieldsPage, EmailSignaturesPage, BusinessPoliciesPage } from "@/features/settings/store-pages";
import { TemplateStudioPage } from "@/features/settings/document-templates-page";
import { DocumentPage } from "@/components/document-view";
import { ModuleCataloguePage } from "@/features/settings/catalogue-page";
import { FleetHub } from "@/features/fleet/hub";
import { WarehouseHub } from "@/features/wms/hub";
import { HrHub } from "@/features/hr/hub";
import { FinanceHub } from "@/features/finance/hub";
import { Planned } from "@/features/scaffold/screen-scaffold";
import { SalesHub } from "@/features/sales/hub";
import { CommercialHub } from "@/features/commercial/hub";
import { VaultHub } from "@/features/vault/hub";
import { PortalAccessPage } from "@/features/portal/pages";
import { WorkspacePage } from "@/features/workspace/workspace-page";
import { MasterDataPage } from "@/features/masterdata/master-data-page";
import { OperationsHub } from "@/features/operations/hub";
import { CostingHub } from "@/features/costing/hub";
import { ProcurementHub } from "@/features/procurement/hub";
import { AiControlHub } from "@/features/ai-control/hub";
import { GodModePage } from "@/features/godmode/godmode-page";
import { SupportPage } from "@/features/support/support-page";
import { CommsHub } from "@/features/comms/hub";
import { BootGate } from "@/app/boot-gate";
import { PwaLayer } from "@/components/pwa/pwa-layer";

export function App() {
  return (
    <BootGate>
      <PwaLayer />
      <Routes>
        <Route path="/login" element={<LandingPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

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
        {/* Fleet — one hub, deep-linkable tabs */}
        <Route path="fleet" element={<FleetHub />} />
        <Route path="fleet/:section" element={<FleetHub />} />
        {/* Warehouse — one hub, deep-linkable tabs */}
        <Route path="wms" element={<WarehouseHub />} />
        <Route path="wms/:section" element={<WarehouseHub />} />
        {/* People & HR — one hub, deep-linkable tabs (old /hr/<screen> paths resolve) */}
        <Route path="hr" element={<HrHub />} />
        <Route path="hr/:section" element={<HrHub />} />
        {/* Finance — one hub, deep-linkable tabs (per-section routes still resolve) */}
        <Route path="finance" element={<FinanceHub />} />
        <Route path="finance/:section" element={<FinanceHub />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="workflows" element={<WorkflowsPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="appearance" element={<AppearancePage />} />
        <Route path="settings" element={<SettingsHub />} />

        {/* --- IA-map screens not yet built → shared placeholder (see doc/FE_IA_HANDOFF.md) --- */}
        {/* Overview */}
        <Route path="workspace" element={<WorkspacePage />} />
        <Route path="help" element={<HelpPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="godmode" element={<GodModePage />} />
        {/* AI Control — governance admin hub */}
        <Route path="ai-control" element={<AiControlHub />} />
        <Route path="ai-control/:section" element={<AiControlHub />} />
        {/* Commercial */}
        {/* Commercial — one hub, deep-linkable tabs */}
        <Route path="commercial" element={<CommercialHub />} />
        <Route path="commercial/:section" element={<CommercialHub />} />
        {/* Sales & CRM — one hub, deep-linkable tabs (intake is a Leads tab) */}
        <Route path="sales" element={<SalesHub />} />
        <Route path="sales/inbound-intake" element={<Navigate to="/sales/leads?tab=intake" replace />} />
        <Route path="sales/:section" element={<SalesHub />} />
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
        <Route path="settings/document-templates" element={<TemplateStudioPage />} />
        <Route path="documents/:docType/:id" element={<DocumentPage />} />
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