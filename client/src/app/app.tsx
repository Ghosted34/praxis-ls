import { lazy, Suspense } from "react";
import type { ComponentType } from "react";
import { useLang } from "@/lib/i18n";
import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth } from "@/app/auth/require-auth";
import { useAuth } from "@/app/auth/auth-context";
import { AppShell } from "@/app/layout/app-shell";
import { NavTrailProvider } from "@/app/layout/nav-trail-provider";
import { ShellProvider } from "@/app/layout/shell-providers";
import { LandingPage } from "@/features/landing/landing-page";
import { BootGate } from "@/app/boot-gate";
import { PwaLayer } from "@/components/pwa/pwa-layer";
import { MaintenanceBanner } from "@/components/maintenance-banner";
import { UserAppearanceSync } from "@/app/branding/user-appearance-sync";
import { Spinner } from "@/components/ui/states";
import { ConnectionLost } from "@/components/connection/connection-lost";
import { useConnection } from "@/lib/connection";
import { tokenStore } from "@/lib/token-store";
import { withChunkReload } from "@/lib/chunk-reload";

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
  // Wrapped so a chunk that no longer exists — the normal state of any tab that
  // was open across a deploy — reloads to the current build instead of showing
  // "This screen couldn't be displayed". See lib/chunk-reload.ts.
  return lazy(
    withChunkReload(() => load().then((m) => ({ default: m[name] }))),
  );
}

const ResetPasswordPage = lazyNamed(
  () => import("@/features/auth/reset-password-page"),
  "ResetPasswordPage",
);
// The stranger-facing surfaces — the marketing site (/public/*) and the external
// portal (/portal/*) — used to be lazy routes in THIS app. They are now their own
// application (public-web/), served on the same origin by src/server.js. Two
// implementations of one URL is how a visitor ends up on whichever copy their
// cache happens to hold, so the copies here are gone rather than deprecated.
//
// What stays below is deliberately NOT part of that move: verification and
// signing are stranger-facing too, but they belong to the vault, are reached from
// a printed QR or a one-time token, and were never part of the marketing site.
//
// The verification portal. Two routes, one component: `/v/:code` is what a
// printed QR resolves to, `/verify` is the manual-entry form for someone
// reading the code off the page (or down a phone line).
const VerifyPage = lazyNamed(() => import("@/features/public/verify-page"), "VerifyPage");
// The public signing page. `/sign/:token`, and short for the same reason `/v`
// is: the link is read off a phone screen and occasionally typed.
const SignPage = lazyNamed(() => import("@/features/public/sign-page"), "SignPage");
const PortalAccessPage = lazyNamed(
  () => import("@/features/portal/pages"),
  "PortalAccessPage",
);
const AuditRoomPage = lazyNamed(
  () => import("@/features/portal/data-room"),
  "AuditRoomPage",
);
const ClientSupportPage = lazyNamed(
  () => import("@/features/portal/client-support"),
  "ClientSupportPage",
);
const SelfServicePage = lazyNamed(
  () => import("@/features/hr/self-service"),
  "SelfServicePage",
);
const DashboardPage = lazyNamed(
  () => import("@/features/dashboard"),
  "DashboardPage",
);
const HelpPage = lazyNamed(
  () => import("@/features/help/help-page"),
  "HelpPage",
);
const SupportPage = lazyNamed(
  () => import("@/features/support/support-page"),
  "SupportPage",
);
const GodModePage = lazyNamed(
  () => import("@/features/godmode/godmode-page"),
  "GodModePage",
);
const WorkspacePage = lazyNamed(
  () => import("@/features/workspace/workspace-page"),
  "WorkspacePage",
);
const Planned = lazyNamed(
  () => import("@/features/scaffold/screen-scaffold"),
  "Planned",
);
const DocumentPage = lazyNamed(
  () => import("@/components/document-view"),
  "DocumentPage",
);

// Hubs — one chunk each, which is also one feature area each.
const SecurityHub = lazyNamed(
  () => import("@/features/security/hub"),
  "SecurityHub",
);
const GovernanceHub = lazyNamed(
  () => import("@/features/governance/hub"),
  "GovernanceHub",
);
const FleetHub = lazyNamed(() => import("@/features/fleet/hub"), "FleetHub");
const WarehouseHub = lazyNamed(
  () => import("@/features/wms/hub"),
  "WarehouseHub",
);
const HrHub = lazyNamed(() => import("@/features/hr/hub"), "HrHub");
const FinanceHub = lazyNamed(
  () => import("@/features/finance/hub"),
  "FinanceHub",
);
const SalesHub = lazyNamed(() => import("@/features/sales/hub"), "SalesHub");
// Lead 360 and Intake 360 — one module, so the two dossiers share a chunk.
const LeadDossierPage = lazyNamed(
  () => import("@/features/sales/sales-360"),
  "LeadDossierPage",
);
const IntakeDossierPage = lazyNamed(
  () => import("@/features/sales/sales-360"),
  "IntakeDossierPage",
);
const CommercialHub = lazyNamed(
  () => import("@/features/commercial/hub"),
  "CommercialHub",
);
const VaultHub = lazyNamed(() => import("@/features/vault/hub"), "VaultHub");
const OperationsHub = lazyNamed(
  () => import("@/features/operations/hub"),
  "OperationsHub",
);
// The operations file 360. Its own route, and its own chunk: it is the screen a
// file reference in an email has to be able to point at, and it is not on the
// path of anyone who only opened the hub.
const OperationFile360Page = lazyNamed(
  () => import("@/features/operations/file-360"),
  "OperationFile360Page",
);
// The transit order and delivery note 360s, for the same reason: an OT number
// and a delivery-note reference are what a broker, a client and a driver refer
// to those documents by, so each has to be something you can send.
const TransitOrder360Page = lazyNamed(
  () => import("@/features/operations/transit-order-360"),
  "TransitOrder360Page",
);
const DeliveryNote360Page = lazyNamed(
  () => import("@/features/operations/delivery-note-360"),
  "DeliveryNote360Page",
);
const CostingHub = lazyNamed(
  () => import("@/features/costing/hub"),
  "CostingHub",
);
const ProcurementHub = lazyNamed(
  () => import("@/features/procurement/hub"),
  "ProcurementHub",
);
const AiControlHub = lazyNamed(
  () => import("@/features/ai-control/hub"),
  "AiControlHub",
);
// The assistant's own screen. Its own chunk, and a big one (the three panes, the
// canvas, the table view) — which is exactly why it must not be bundled with the
// drawer: the drawer is mounted on every screen in the product, and it stays
// small by handing the heavy surface off to this route.
const AiWorkspace = lazyNamed(
  () => import("@/features/ai/workspace"),
  "AiWorkspace",
);
const CommsHub = lazyNamed(() => import("@/features/comms/hub"), "CommsHub");
const SettingsHub = lazyNamed(
  () => import("@/features/settings/settings-hub"),
  "SettingsHub",
);
const MasterDataPage = lazyNamed(
  () => import("@/features/masterdata/master-data-page"),
  "MasterDataPage",
);
const EntityDossierPage = lazyNamed(
  () => import("@/features/masterdata/entity-360"),
  "EntityDossierPage",
);
// Treasury account 360 — deep-linkable so an invoice footer, a payment receipt,
// or a compliance alert can drop the user straight into the account's dossier.
const TreasuryDossierPage = lazyNamed(
  () => import("@/features/master/treasury"),
  "TreasuryDossierPage",
);
const MyHrPage = lazyNamed(() => import("@/features/hr/my-hr"), "MyHrPage");

// Governance leaf screens — all four live in one module, so they share a chunk.
const AuditPage = lazyNamed(
  () => import("@/features/governance/audit"),
  "AuditPage",
);
const NotificationsPage = lazyNamed(
  () => import("@/features/governance/notifications"),
  "NotificationsPage",
);
const WorkflowsPage = lazyNamed(
  () => import("@/features/governance/workflows"),
  "WorkflowsPage",
);
const ApprovalsPage = lazyNamed(
  () => import("@/features/governance/approvals"),
  "ApprovalsPage",
);

// Settings leaf editors.
const AppearancePage = lazyNamed(
  () => import("@/features/settings/appearance-page"),
  "AppearancePage",
);
// Self-service typography. Separate chunk from the tenant editor above: every
// user can reach this one, only Settings-edit holders reach that one, so they
// should not share a download.
const MyAppearancePage = lazyNamed(
  () => import("@/features/settings/my-appearance"),
  "MyAppearancePage",
);
const LoginEditor = lazyNamed(
  () => import("@/features/settings/login-editor"),
  "LoginEditor",
);
const PwaPage = lazyNamed(
  () => import("@/features/settings/pwa-page"),
  "PwaPage",
);
const WebsitePagesPage = lazyNamed(
  () => import("@/features/settings/website-pages"),
  "WebsitePagesPage",
);
const WebsitePageEditorPage = lazyNamed(
  () => import("@/features/settings/website-page-editor"),
  "WebsitePageEditorPage",
);
const TemplateStudioPage = lazyNamed(
  () => import("@/features/settings/document-templates-page"),
  "TemplateStudioPage",
);
const ModuleCataloguePage = lazyNamed(
  () => import("@/features/settings/catalogue-page"),
  "ModuleCataloguePage",
);
const PaymentGatewaysPage = lazyNamed(
  () => import("@/features/settings/payment-gateways"),
  "PaymentGatewaysPage",
);
const ScheduledReportsPage = lazyNamed(
  () => import("@/features/settings/scheduled-reports"),
  "ScheduledReportsPage",
);
const ApiKeysPage = lazyNamed(
  () => import("@/features/settings/api-keys"),
  "ApiKeysPage",
);
const PipelineStagesPage = lazyNamed(
  () => import("@/features/settings/pipeline-stages"),
  "PipelineStagesPage",
);
const NumberingPage = lazyNamed(
  () => import("@/features/settings/numbering"),
  "NumberingPage",
);
const CustomFieldsPage = lazyNamed(
  () => import("@/features/settings/custom-fields"),
  "CustomFieldsPage",
);
const EmailSignaturesPage = lazyNamed(
  () => import("@/features/settings/email-signatures"),
  "EmailSignaturesPage",
);
const DeliverabilityPage = lazyNamed(
  () => import("@/features/settings/deliverability-panel"),
  "DeliverabilityPage",
);
const BusinessPoliciesPage = lazyNamed(
  () => import("@/features/settings/business-policies"),
  "BusinessPoliciesPage",
);
const SignaturesSettingsPage = lazyNamed(
  () => import("@/features/settings/signatures-page"),
  "SignaturesSettingsPage",
);

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
    <div
      className="flex min-h-screen items-center justify-center"
      role="status"
      aria-label="Loading page"
    >
      <Spinner />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/**
 * The always-on offline page. Whenever the app is offline AND has no
 * authenticated session to render, this shows the crafted `ConnectionLost` panel
 * — with the opt-in "Beat the downtime" puzzle — in place of the routes.
 *
 * WHY IT GUARDS THE ROUTES RATHER THAN LIVING IN THE LOGIN. A cold reload while
 * offline can't verify the session, so the user is momentarily "anonymous" and
 * the router would send them to a login they cannot complete offline (the exact
 * behaviour reported: connection drops, reload, and the branded workspace is
 * replaced by a login). Catching it here means the offline page shows for every
 * unauthenticated-offline state — boot, a genuine sign-in, a portal — not just
 * one screen.
 *
 * WHY AN AUTHENTICATED USER IS NEVER COVERED. Their running screens stay
 * mounted, and each one already handles its own offline in place (ScreenError →
 * ConnectionLost) alongside the top pill. Taking the whole app over would hide a
 * half-filled form to explain why it can't be saved — the one move the offline
 * design forbids. So the takeover is strictly for the "nothing to protect yet"
 * states.
 *
 * The brand it wears is the tenant's: appearance-cache repaints the cached
 * colours/name and the service worker serves the cached logo, so this is the
 * tenant's offline page, not the vendor's.
 */
function OfflineBootGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const { status: conn } = useConnection();

  if (conn === "unreachable" && status !== "authed") {
    return (
      <div className="grid min-h-screen place-items-center p-4">
        <ConnectionLost what="Your workspace" className="w-full max-w-lg" />
      </div>
    );
  }

  // Reconnected, but the session is still being re-verified (auth-context re-runs
  // the token exchange on the same reconnect signal). Hold a spinner for that
  // beat rather than flashing the login on the way back to the screen the user
  // was on. Only while a refresh token is actually present — a signed-out user
  // has nothing to wait for and falls straight through to the login.
  if (conn === "online" && status !== "authed" && tokenStore.getRefresh()) {
    return (
      <div
        className="grid min-h-screen place-items-center"
        role="status"
        aria-label="Reconnecting"
      >
        <Spinner />
        <span className="sr-only">Reconnecting…</span>
      </div>
    );
  }

  return <>{children}</>;
}


export function App() {
  useLang();
  return (
    <BootGate>
      <PwaLayer />
      {/* WS-M1. ABOVE <Routes> so it renders on /login too: during a fleet-wide
          window the people who most need the message are the ones staring at a
          login screen wondering why nothing works. Its endpoint is
          unauthenticated for the same reason. */}
      <MaintenanceBanner />
      {/* Renders nothing. Sits here because it needs BOTH auth (for the token)
          and branding (to paint) — BrandingProvider is above AuthProvider in
          main.tsx, so this is the highest point where both are readable. */}
      <UserAppearanceSync />
      {/* The crafted offline page stands in for the routes whenever we're offline
          without a session to show — see OfflineBootGate. PwaLayer above stays
          mounted OUTSIDE it, so the connection monitor keeps probing and the pill
          keeps working while the gate is up. */}
      <OfflineBootGate>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<LandingPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/* The external portal and the marketing site are served from
            public-web/ now (src/server.js mounts them on this same origin), so
            their routes are not declared here any more. Removing them rather
            than leaving them behind a flag is the point: while both existed, which
            one a visitor got depended on this app's service worker cache, and the
            copy it held was the older one — a wrong page that looked right.

            The staff side of the portal is unaffected and stays in this app:
            /settings/portal-access, /settings/client-support and the audit room
            are where a member of staff invites portal users, answers their
            tickets and publishes documents to them. */}

            {/* The verification portal. Deliberately NOT under `/public/*`,
            which every other stranger-facing surface uses — and the exception
            is measured, not stylistic. This path is printed inside a QR that
            has 22mm to live in and has to survive a photocopier and a phone
            camera in a badly-lit warehouse. At `/v/{12-char code}` the URL is
            40 characters and the symbol needs 33 modules — 0.67mm each; under
            a `/public/verify/` prefix it is 52 characters, which costs a whole
            QR version and drops to 0.59mm, and the original long-token design
            sat at 0.49mm, right on the threshold a phone needs before anything
            touched it (SIGNATURE_ENGINEERING_GUIDE §3.7).

            Lengthening this path degrades a printed artefact that cannot be
            re-issued, so it does not move to match a naming convention.

            Outside RequireAuth and outside AppShell like the rest: the visitor
            is a customs officer or an accounts clerk with no account, and the
            shell would put a LIVE/TEST toggle and a copilot in front of them
            while firing authenticated requests on mount. */}
            <Route path="/v/:code" element={<VerifyPage />} />
            <Route path="/verify" element={<VerifyPage />} />

            {/* The signing page. Outside RequireAuth and outside AppShell like
            the portal: the counterparty is a stranger on a phone with no
            account, and the shell would put a LIVE/TEST toggle and a copilot in
            front of them while firing authenticated requests on mount.

            The token in the URL is the party's minted signing credential and
            the ONLY thing the endpoint accepts — never an internal id, because
            ids appear in staff URLs and logs and accepting one here would make
            every internal identifier a signing credential. */}
            <Route path="/sign/:token" element={<SignPage />} />

            {/* The old public slugs (/track, /portfolio, /proposal/:token,
            /careers, /client-portal/*) are redirected by public-web's router now,
            which is also what answers the paths they redirect TO. Keeping a second
            redirect table here would mean two answers to one URL again. */}

            {/* ShellProvider sits INSIDE RequireAuth (its two reads need a token) and
          OUTSIDE AppShell, so the routed screens are inside it too — the rail
          editor on My appearance reads and writes the same preferences the rail
          itself does, from one fetch. */}
            <Route
              element={
                <RequireAuth>
                  <ShellProvider>
                    {/* The back/forward trail (app/layout/nav-trail.ts). Mounted
                    here rather than inside AppShell so the routed screens are
                    inside it too — `useRecordParam` on a list page and the
                    arrows in the rail have to be reading the same trail. Inside
                    RequireAuth because it is the authenticated app's history:
                    the login screen has nothing to step back through. */}
                    <NavTrailProvider>
                      <AppShell />
                    </NavTrailProvider>
                  </ShellProvider>
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
              {/* Praxis AI — the assistant's workspace. Sits in Overview beside the
            Control Tower, NOT under AI Control: this is where you USE the
            assistant, AI Control is where an administrator governs it. */}
              <Route path="ai" element={<AiWorkspace />} />
              {/* AI Control — governance admin hub */}
              <Route path="ai-control" element={<AiControlHub />} />
              <Route path="ai-control/:section" element={<AiControlHub />} />
              {/* Commercial */}
              {/* Commercial — one hub, deep-linkable tabs */}
              <Route path="commercial" element={<CommercialHub />} />
              <Route path="commercial/:section" element={<CommercialHub />} />
              {/* Sales & CRM — one hub, deep-linkable tabs (intake is a Leads tab) */}
              <Route path="sales" element={<SalesHub />} />
              <Route
                path="sales/inbound-intake"
                element={<Navigate to="/sales/leads?tab=intake" replace />}
              />
              {/* The two front-of-funnel 360s get their own routes for the same
            reason the entity and treasury dossiers have theirs: a dossier gets
            pasted into an email, and "open Sales, then Leads, then find Tema
            Shipping" is not a link. Declared before `sales/:section` — react-
            router ranks by specificity, so the two-segment paths win either
            way. The same components are embedded in the registers, so the two
            surfaces cannot drift. */}
              <Route path="sales/leads/:leadId" element={<LeadDossierPage />} />
              <Route
                path="sales/quote-requests/:quoteRequestId"
                element={<IntakeDossierPage />}
              />
              <Route path="sales/:section" element={<SalesHub />} />
              {/* Operations — hub */}
              <Route path="operations" element={<OperationsHub />} />
              {/* The file 360 is a full route for the same reason the entity and
            treasury dossiers have theirs: a file reference gets pasted into an
            email, and "open Operations, then Files, then find SBX-2026-0001" is
            not a link. Declared before `operations/:section` — react-router
            ranks by specificity, so the three-segment path wins either way. */}
              <Route
                path="operations/files/:fileId"
                element={<OperationFile360Page />}
              />
              <Route
                path="operations/transit-orders/:orderId"
                element={<TransitOrder360Page />}
              />
              <Route
                path="operations/delivery-notes/:noteId"
                element={<DeliveryNote360Page />}
              />
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
              {/* The entity dossier is a full route, not a tab: it has to be
            deep-linkable from a payroll run, an invoice footer config or a
            compliance alert. Declared before the generic section route; react-
            router ranks by specificity, so the two-segment path wins either way. */}
              <Route
                path="master/corporate-entities/:entityId"
                element={<EntityDossierPage />}
              />
              {/* Same rationale as entities: the treasury 360 has to be deep-linkable
            on its own route so links from invoicing, receipts and alerts work. */}
              <Route
                path="master/treasury-accounts/:id"
                element={<TreasuryDossierPage />}
              />
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
              <Route path="self-service" element={<SelfServicePage />} />
              <Route
                path="settings/catalogue"
                element={<ModuleCataloguePage />}
              />
              {/* Portal grant management. Moved off `/portal/*` (2026-08-17) so
                  the external multi-audience portal can own that prefix. */}
              <Route
                path="settings/portal-access"
                element={<PortalAccessPage />}
              />
              <Route path="settings/audit-room" element={<AuditRoomPage />} />
              <Route path="settings/client-support" element={<ClientSupportPage />} />
              {/* Settings hub cards without a dedicated editor yet */}
              {/* Business setup was a duplicate of the Corporate entities editor (MOD-01) —
            same profile / financial identity / fiscal-year fields. Retired 2026-07-18;
            the missing bits (address, bank block, letterhead logo) were folded into
            that editor instead. Redirect keeps old links + the Settings hub card working. */}
              <Route
                path="settings/business-setup"
                element={<Navigate to="/master/corporate-entities" replace />}
              />
              <Route
                path="settings/signatures"
                element={<SignaturesSettingsPage />}
              />
              <Route path="settings/login" element={<LoginEditor />} />
              <Route path="settings/pwa" element={<PwaPage />} />
              {/* The tenant's public website. The list and the page editor are
                  two routes rather than one screen with a drawer: a page's
                  identity and its blocks are edited at different rhythms, and a
                  block save that re-rendered the identity form would lose a
                  half-typed meta description. */}
              <Route path="settings/website" element={<WebsitePagesPage />} />
              <Route
                path="settings/website/:pageId"
                element={<WebsitePageEditorPage />}
              />
              <Route
                path="settings/business-policies"
                element={<BusinessPoliciesPage />}
              />
              <Route
                path="settings/payment-gateways"
                element={<PaymentGatewaysPage />}
              />
              <Route
                path="settings/custom-fields"
                element={<CustomFieldsPage />}
              />
              <Route
                path="settings/pipeline-stages"
                element={<PipelineStagesPage />}
              />
              <Route
                path="settings/scheduled-reports"
                element={<ScheduledReportsPage />}
              />
              <Route path="settings/api-keys" element={<ApiKeysPage />} />
              <Route path="settings/factory-languages" element={<Planned />} />
              <Route
                path="settings/document-templates"
                element={<TemplateStudioPage />}
              />
              <Route path="documents/:docType/:id" element={<DocumentPage />} />
              <Route
                path="settings/email-signatures"
                element={<EmailSignaturesPage />}
              />
              <Route
                path="settings/deliverability"
                element={<DeliverabilityPage />}
              />
              {/* No BE yet — scaffolded like factory-languages. The Settings hub still
            links here (settings-hub.tsx), so without this route the card dead-ends
            on the catch-all redirect. */}
              <Route path="settings/help-center" element={<Planned />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </OfflineBootGate>
    </BootGate>
  );
}
