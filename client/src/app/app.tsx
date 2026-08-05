import { lazy, Suspense } from "react";
import type { ComponentType } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth } from "@/app/auth/require-auth";
import { AppShell } from "@/app/layout/app-shell";
import { LandingPage } from "@/features/landing/landing-page";
import { BootGate } from "@/app/boot-gate";
import { PwaLayer } from "@/components/pwa/pwa-layer";
import { UserAppearanceSync } from "@/app/branding/user-appearance-sync";
import { Spinner } from "@/components/ui/states";

/**
 * ROUTE-LEVEL CODE SPLITTING (audit F16 / Phase 4 — "62 routes in one entry
 * bundle"). Every screen below is a dynamic import, so Rollup derives one chunk
 * per screen from the real module graph.
 *
 * This replaces the hand-written `feature-*` buckets that used to live in
 * vite.config.ts. Those buckets were a partition drawn by hand over a graph that
 * has cross-area edges (finance/pages.tsx imports from sales/ui.tsx, and so on),
 * so they went circular — settings → hr → wms → fleet → settings — and a
 * circular chunk graph serves a blank page. Dynamic imports cannot do that:
 * Rollup's own chunking is acyclic by construction, and adding a feature area
 * now needs no build-config change at all.
 *
 * EAGER on purpose, and only these:
 *   BootGate / PwaLayer / RequireAuth / AppShell — the shell itself; splitting
 *     it would only add a round trip in front of every route.
 *   LandingPage — the login screen. It is the cold-start destination for every
 *     unauthenticated visit, so making it lazy puts a second network round trip
 *     in front of first paint, which is the one place that cost is felt.
 */

/**
 * React.lazy only understands a `default` export; every screen here is a named
 * one. The `M extends { [P in K]: ComponentType }` constraint is what makes this
 * safe — a renamed or misspelled export fails `tsc -b` rather than resolving to
 * `undefined` and blanking the route at navigation time.
 */
function lazyNamed<K extends string, M extends { [P in K]: ComponentType }>(
  load: () => Promise<M>,
  name: K,
) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

const ResetPasswordPage = lazyNamed(() => import("@/features/auth/reset-password-page"), "ResetPasswordPage");
const PortalApp = lazyNamed(() => import("@/features/portal/portal-app"), "PortalApp");
const PortalAccessPage = lazyNamed(() => import("@/features/portal/pages"), "PortalAccessPage");

const DashboardPage = lazyNamed(() => import("@/features/dashboard"), "DashboardPage");
const HelpPage = lazyNamed(() => import("@/features/help/help-page"), "HelpPage");
const SupportPage = lazyNamed(() => import("@/features/support/support-page"), "SupportPage");
const GodModePage = lazyNamed(() => import("@/features/godmode/godmode-page"), "GodModePage");
const WorkspacePage = lazyNamed(() => import("@/features/workspace/workspace-page"), "WorkspacePage");
const Planned = lazyNamed(() => import("@/features/scaffold/screen-scaffold"), "Planned");
const DocumentPage = lazyNamed(() => import("@/components/document-view"), "DocumentPage");

// Hubs — one chunk each, which is also one feature area each.
const SecurityHub = lazyNamed(() => import("@/features/security/hub"), "SecurityHub");
const GovernanceHub = lazyNamed(() => import("@/features/governance/hub"), "GovernanceHub");
const FleetHub = lazyNamed(() => import("@/features/fleet/hub"), "FleetHub");
const WarehouseHub = lazyNamed(() => import("@/features/wms/hub"), "WarehouseHub");
const HrHub = lazyNamed(() => import("@/features/hr/hub"), "HrHub");
const FinanceHub = lazyNamed(() => import("@/features/finance/hub"), "FinanceHub");
const SalesHub = lazyNamed(() => import("@/features/sales/hub"), "SalesHub");
const CommercialHub = lazyNamed(() => import("@/features/commercial/hub"), "CommercialHub");
const VaultHub = lazyNamed(() => import("@/features/vault/hub"), "VaultHub");
const OperationsHub = lazyNamed(() => import("@/features/operations/hub"), "OperationsHub");
const CostingHub = lazyNamed(() => import("@/features/costing/hub"), "CostingHub");
const ProcurementHub = lazyNamed(() => import("@/features/procurement/hub"), "ProcurementHub");
const AiControlHub = lazyNamed(() => import("@/features/ai-control/hub"), "AiControlHub");
const CommsHub = lazyNamed(() => import("@/features/comms/hub"), "CommsHub");
const SettingsHub = lazyNamed(() => import("@/features/settings/settings-hub"), "SettingsHub");
const MasterDataPage = lazyNamed(() => import("@/features/masterdata/master-data-page"), "MasterDataPage");
const MyHrPage = lazyNamed(() => import("@/features/hr/my-hr"), "MyHrPage");

// Governance leaf screens — all four live in one module, so they share a chunk.
const AuditPage = lazyNamed(() => import("@/features/governance/audit"), "AuditPage");
const NotificationsPage = lazyNamed(() => import("@/features/governance/notifications"), "NotificationsPage");
const WorkflowsPage = lazyNamed(() => import("@/features/governance/workflows"), "WorkflowsPage");
const ApprovalsPage = lazyNamed(() => import("@/features/governance/approvals"), "ApprovalsPage");

// Settings leaf editors.
const AppearancePage = lazyNamed(() => import("@/features/settings/appearance-page"), "AppearancePage");
// Self-service typography. Separate chunk from the tenant editor above: every
// user can reach this one, only Settings-edit holders reach that one, so they
// should not share a download.
const MyAppearancePage = lazyNamed(() => import("@/features/settings/my-appearance"), "MyAppearancePage");
const LoginEditor = lazyNamed(() => import("@/features/settings/login-editor"), "LoginEditor");
const TemplateStudioPage = lazyNamed(() => import("@/features/settings/document-templates-page"), "TemplateStudioPage");
const ModuleCataloguePage = lazyNamed(() => import("@/features/settings/catalogue-page"), "ModuleCataloguePage");
const PaymentGatewaysPage = lazyNamed(() => import("@/features/settings/payment-gateways"), "PaymentGatewaysPage");
const ScheduledReportsPage = lazyNamed(() => import("@/features/settings/scheduled-reports"), "ScheduledReportsPage");
const ApiKeysPage = lazyNamed(() => import("@/features/settings/api-keys"), "ApiKeysPage");
const PipelineStagesPage = lazyNamed(() => import("@/features/settings/pipeline-stages"), "PipelineStagesPage");
const NumberingPage = lazyNamed(() => import("@/features/settings/numbering"), "NumberingPage");
const CustomFieldsPage = lazyNamed(() => import("@/features/settings/custom-fields"), "CustomFieldsPage");
const EmailSignaturesPage = lazyNamed(() => import("@/features/settings/email-signatures"), "EmailSignaturesPage");
const BusinessPoliciesPage = lazyNamed(() => import("@/features/settings/business-policies"), "BusinessPoliciesPage");

/**
 * Fallback for the routes that render OUTSIDE the shell (reset-password, the
 * client portal). Inside the shell the boundary lives next to `<Outlet />` in
 * app-shell.tsx, so the nav and topbar stay on screen and the fallback is a
 * PageSkeleton in the content column rather than a bare spinner.
 *
 * In practice this is rarely seen: BrowserRouter runs with `v7_startTransition`
 * (main.tsx), so React keeps the current screen painted while the next route's
 * chunk arrives instead of flashing a fallback on every navigation.
 */
function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading page">
      <Spinner />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function App() {
  return (
    <BootGate>
      <PwaLayer />
      {/* Renders nothing. Sits here because it needs BOTH auth (for the token)
          and branding (to paint) — BrandingProvider is above AuthProvider in
          main.tsx, so this is the highest point where both are readable. */}
      <UserAppearanceSync />
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LandingPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* External client portal. OUTSIDE RequireAuth and AppShell on purpose:
            a portal user has no app_user row, no role and no refresh token, so
            it authenticates against its own token store (lib/portal-api.ts) and
            never renders staff navigation. The wildcard keeps every path inside
            the portal — an external user should never fall through to a staff
            screen or a staff 404.

            NOT `/portal/*`: the STAFF grant-management screen already owns
            `/portal/access` (below). React Router would rank the static path
            above the splat and probably keep them apart, but an authentication
            boundary should not depend on route-scoring subtleties — one nested
            route added later and an external user is looking at a staff screen.
            Separate prefix, no overlap, and it reads better in an invite email. */}
        <Route path="/client-portal/*" element={<PortalApp />} />

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
        <Route path="governance" element={<GovernanceHub />} />
        <Route path="my-hr" element={<MyHrPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="workflows" element={<WorkflowsPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="appearance" element={<AppearancePage />} />
        <Route path="my-appearance" element={<MyAppearancePage />} />
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
      </Suspense>
    </BootGate>
  );
}
