/**
 * Client portal — routing, the role switcher and the auth guard.
 *
 * The rest of the portal moved into siblings in Phase 4 (audit F7); this is the
 * shell that composes them.
 */

import * as React from "react";
import { useLang } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { Routes, Route, Navigate } from "react-router-dom";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { portalToken, portalMe, type PortalMe } from "@/lib/portal-api";
import {
  AuditorTerminal,
  ClientTerminal,
  InvestorTerminal,
} from "./portal-terminals";
import { PortalFrame, msg } from "./portal-chrome";
import { PortalLogin, PortalSetPassword } from "./portal-auth";

const PORTALS = ["CLIENT", "INVESTOR", "AUDITOR"] as const;
type PortalKind = (typeof PORTALS)[number];
/** Keys, not labels. A module-level English map is the idiom this app rejects:
 *  the tab a French reader sees would stay in English until a remount, so the
 *  label is looked up at render instead. */
const TAB_KEY: Record<PortalKind, string> = {
  CLIENT: "portal.shipments",
  INVESTOR: "portal.financials",
  AUDITOR: "portal.auditRoom",
};

function PortalHome() {
  const { t } = useTranslation();
  const [me, setMe] = React.useState<PortalMe | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<PortalKind | null>(null);

  React.useEffect(() => {
    let alive = true;
    portalMe()
      .then((m) => {
        if (!alive) return;
        setMe(m);
        setTab(PORTALS.find((p) => m.grants[p]?.allowed) || null);
      })
      .catch((e) => alive && setError(msg(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error)
    return (
      <PortalFrame wide>
        <ErrorState message={error} />
      </PortalFrame>
    );
  if (!me)
    return (
      <PortalFrame wide>
        <SkeletonTable />
      </PortalFrame>
    );

  const allowed = PORTALS.filter((p) => me.grants[p]?.allowed);

  // A login can exist with no usable grant — revoked or expired. Say so plainly
  // instead of rendering empty tables, which would read as "you have no data".
  if (!tab) {
    return (
      <PortalFrame wide>
        <EmptyState
          title={t("portal.noActiveAccess")}
          hint={t("portal.noActiveAccessHint")}
        />
      </PortalFrame>
    );
  }

  return (
    <PortalFrame wide>
      {allowed.length > 1 ? (
        <div className="mb-6 inline-flex rounded-full border border-border bg-card p-1">
          {allowed.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setTab(kind)}
              aria-current={tab === kind ? "true" : undefined}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                tab === kind
                  ? "btn-primary !h-auto !px-4 !py-1.5"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(TAB_KEY[kind])}
            </button>
          ))}
        </div>
      ) : null}
      {tab === "CLIENT" ? (
        <ClientTerminal me={me} />
      ) : tab === "INVESTOR" ? (
        <InvestorTerminal me={me} />
      ) : (
        <AuditorTerminal me={me} />
      )}
    </PortalFrame>
  );
}

/**
 * Guard. Checks ONLY the portal token — a signed-in staff user is not a portal
 * user and must land on the portal sign-in like anyone else.
 */
function PortalGuard({ children }: { children: React.ReactNode }) {
  if (!portalToken.get()) return <Navigate to="/portal/login" replace />;
  return <>{children}</>;
}

export function PortalApp() {
  useLang();
  return (
    <Routes>
      <Route path="login" element={<PortalLogin />} />
      <Route path="set-password" element={<PortalSetPassword />} />
      <Route
        index
        element={
          <PortalGuard>
            <PortalHome />
          </PortalGuard>
        }
      />
      {/* Anything else under /portal goes to the portal's own entry, never
          the staff app — an external user should never see a staff 404 or nav. */}
      <Route path="*" element={<Navigate to="/portal" replace />} />
    </Routes>
  );
}

export default PortalApp;
