/**
 * Client portal — routing, the role switcher and the auth guard.
 *
 * The rest of the portal moved into siblings in Phase 4 (audit F7); this is the
 * shell that composes them.
 */

import * as React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { portalToken, portalMe, type PortalMe } from "@/lib/portal-api";
import { AuditorTerminal, ClientTerminal, InvestorTerminal } from "./portal-terminals";
import { PortalFrame, msg } from "./portal-chrome";
import { PortalLogin, PortalSetPassword } from "./portal-auth";

const PORTALS = ["CLIENT", "INVESTOR", "AUDITOR"] as const;
type PortalKind = (typeof PORTALS)[number];
const TAB_LABEL: Record<PortalKind, string> = { CLIENT: "Shipments", INVESTOR: "Financials", AUDITOR: "Audit room" };

function PortalHome() {
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

  if (error) return <PortalFrame wide><ErrorState message={error} /></PortalFrame>;
  if (!me) return <PortalFrame wide><SkeletonTable /></PortalFrame>;

  const allowed = PORTALS.filter((p) => me.grants[p]?.allowed);

  // A login can exist with no usable grant — revoked or expired. Say so plainly
  // instead of rendering empty tables, which would read as "you have no data".
  if (!tab) {
    return (
      <PortalFrame wide>
        <EmptyState title="No active access" hint="Your access has expired or been withdrawn. Please contact your account manager." />
      </PortalFrame>
    );
  }

  return (
    <PortalFrame wide>
      {allowed.length > 1 ? (
        <div className="mb-6 inline-flex rounded-full border border-border bg-card p-1">
          {allowed.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      ) : null}
      {tab === "CLIENT" ? <ClientTerminal me={me} /> : tab === "INVESTOR" ? <InvestorTerminal me={me} /> : <AuditorTerminal me={me} />}
    </PortalFrame>
  );
}

/**
 * Guard. Checks ONLY the portal token — a signed-in staff user is not a portal
 * user and must land on the portal sign-in like anyone else.
 */
function PortalGuard({ children }: { children: React.ReactNode }) {
  if (!portalToken.get()) return <Navigate to="/client-portal/login" replace />;
  return <>{children}</>;
}

export function PortalApp() {
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
      {/* Anything else under /client-portal goes to the portal's own entry, never
          the staff app — an external user should never see a staff 404 or nav. */}
      <Route path="*" element={<Navigate to="/client-portal" replace />} />
    </Routes>
  );
}

export default PortalApp;
