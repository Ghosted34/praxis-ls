/**
 * The external portal — a client's, an investor's or an auditor's view of the
 * tenant, behind their own sign-in.
 *
 * What this file owns: the routes, the portal's own light/dark ground (applied
 * on the way in, handed back to the public site on the way out), the layer the
 * sheets and toasts render into, and the gate that decides between the
 * sign-in and the app. Everything a person sees lives under `auth/`,
 * `shell/` and `screens/`.
 *
 * The portal's stylesheet and copy are imported HERE, so they load with the
 * portal's chunk and never with a marketing page's first paint.
 */
import "./portal.css";
import "./portal-i18n";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Routes, Route, Navigate } from "react-router-dom";
import { useLang, getLang } from "@/lib/i18n";
import { applyPortalTheme, restoreSiteTheme, watchSystemTheme, resolvePortalTheme } from "./lib/theme";
import { usePortalPwa } from "./lib/portal-pwa";
import { PortalSessionGate, type PortalKind } from "./lib/portal-context";
import { LayerContext, ToastProvider, EmptyState } from "./ui/kit";
import { BrandMark } from "./ui/brand";
import { LockIcon, LogOutIcon } from "./ui/icons";
import { SignInPage, SignInFrame } from "./auth/sign-in";
import { SetPasswordPage } from "./auth/set-password";
import { PortalShell } from "./shell/portal-shell";
import { HomePage } from "./screens/home";
import { ShipmentsPage } from "./screens/shipments";
import { ShipmentPage } from "./screens/shipment";
import { DocumentsPage } from "./screens/documents";
import { BillingPage } from "./screens/billing";
import { QuotesPage } from "./screens/quotes";
import { AccountPage } from "./screens/account";
import { InvestorTerminal, AuditorTerminal } from "./screens/terminals";

export function PortalApp() {
  useLang();
  const [layer, setLayer] = React.useState<HTMLElement | null>(null);
  // Installable, with notifications and an offline page (lib/portal-pwa.ts):
  // the manifest only while the portal is open, never on the marketing site.
  usePortalPwa({ theme: resolvePortalTheme(), lang: getLang() === "fr" ? "fr" : "en" });

  // Before paint, so the first frame is already the portal's ground.
  React.useLayoutEffect(() => {
    applyPortalTheme();
    const stop = watchSystemTheme();
    return () => {
      stop();
      restoreSiteTheme();
    };
  }, []);

  return (
    <div className="pt-root">
      <LayerContext.Provider value={layer}>
        <ToastProvider>
          <Routes>
            <Route path="login" element={<SignInPage />} />
            <Route path="set-password" element={<SetPasswordPage />} />
            <Route path="*" element={<SignedIn />} />
          </Routes>
        </ToastProvider>
      </LayerContext.Provider>
      <div ref={setLayer} />
    </div>
  );
}

function SignedIn() {
  return (
    <PortalSessionGate splash={<Splash />} noAccess={(signOut) => <NoAccess onSignOut={signOut} />}>
      {(ctx) => (
        <PortalShell>
          {ctx.kind === "CLIENT" ? (
            <Routes>
              <Route index element={<HomePage />} />
              <Route path="shipments" element={<Guard ok={ctx.canOps} el={<ShipmentsPage />} />} />
              <Route path="shipments/:id" element={<Guard ok={ctx.canOps} el={<ShipmentPage />} />} />
              <Route path="documents" element={<Guard ok={ctx.canOps} el={<DocumentsPage />} />} />
              <Route path="quotes" element={<Guard ok={ctx.canOps} el={<QuotesPage />} />} />
              <Route path="billing" element={<Guard ok={ctx.canBilling} el={<BillingPage />} />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="*" element={<Navigate to="/portal" replace />} />
            </Routes>
          ) : (
            <Routes>
              <Route index element={<Terminal kind={ctx.kind} />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="*" element={<Navigate to="/portal" replace />} />
            </Routes>
          )}
        </PortalShell>
      )}
    </PortalSessionGate>
  );
}

/** A colleague given only billing who follows a shipment link lands on Home,
 *  not on a screen of 403s. */
function Guard({ ok, el }: { ok: boolean; el: React.ReactElement }) {
  return ok ? el : <Navigate to="/portal" replace />;
}

function Terminal({ kind }: { kind: PortalKind }) {
  return kind === "INVESTOR" ? <InvestorTerminal /> : <AuditorTerminal />;
}

/** While the session is checked: the tenant's mark on the portal's ground. */
function Splash() {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-[100dvh] place-items-center" role="status" aria-label={t("portal.common.loading")}>
      <div className="flex flex-col items-center gap-6">
        <BrandMark className="max-h-12" />
        <span className="pt-spinner animate-spin text-primary-ink" aria-hidden="true" />
      </div>
    </div>
  );
}

function NoAccess({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useTranslation();
  return (
    <SignInFrame info={false}>
      <EmptyState
        className="!px-0 !py-2"
        tone="warn"
        icon={<LockIcon size={28} />}
        title={t("portal.noAccess.title")}
        hint={t("portal.noAccess.hint")}
        action={
          <button type="button" className="pt-btn pt-btn-soft" onClick={onSignOut}>
            <LogOutIcon size={20} />
            {t("portal.account.signOut")}
          </button>
        }
      />
    </SignInFrame>
  );
}

export default PortalApp;
