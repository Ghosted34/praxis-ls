/**
 * Who is signed in to the portal, what they may open, and how they leave.
 *
 * Loaded once when the shell mounts (`/me`), and kept for the visit. Every
 * screen reads the scope from here to decide what it shows: a colleague given
 * only BILLING sees Home and Billing and nothing that would 403.
 */
import * as React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { portalMe, portalLogout, type PortalMe, type Scope } from "@/lib/portal-api";
import { portalSession, refreshPortalSession, PORTAL_SIGNED_OUT } from "@/lib/portal-session";

export type PortalKind = "CLIENT" | "INVESTOR" | "AUDITOR";

type Ctx = {
  me: PortalMe;
  kind: PortalKind;
  scope: Scope;
  isAdmin: boolean;
  canOps: boolean;
  canBilling: boolean;
  firstName: string | null;
  company: string | null;
  reloadMe: () => Promise<void>;
  signOut: (opts?: { forget?: boolean }) => Promise<void>;
};

const PortalCtx = React.createContext<Ctx | null>(null);

export function usePortal(): Ctx {
  const v = React.useContext(PortalCtx);
  if (!v) throw new Error("usePortal outside the portal shell");
  return v;
}

export const firstNameOf = (full: string | null | undefined): string | null => {
  const s = String(full || "").trim();
  return s ? s.split(/\s+/)[0] : null;
};

/** Which terminal a login opens on: a client first, then investor, auditor. */
export function kindsOf(me: PortalMe): PortalKind[] {
  return (["CLIENT", "INVESTOR", "AUDITOR"] as PortalKind[]).filter((k) => me.grants[k]?.allowed);
}

type Status = { state: "checking" } | { state: "out" } | { state: "in"; me: PortalMe };

/**
 * The guard. A device kept signed in refreshes silently here — the person
 * opening the installed portal tomorrow lands on Home, not on a sign-in form.
 * A device that was not goes to sign-in, carrying where it was headed.
 */
export function PortalSessionGate({
  children,
  splash,
  noAccess,
}: {
  children: (ctx: Ctx) => React.ReactNode;
  splash: React.ReactNode;
  noAccess: (signOut: () => void) => React.ReactNode;
}) {
  const [status, setStatus] = React.useState<Status>({ state: "checking" });
  const [kind, setKind] = React.useState<PortalKind | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  const hereRef = React.useRef(here);
  hereRef.current = here;

  const toSignIn = React.useCallback(() => {
    const next = hereRef.current;
    navigate(`/portal/login${next && next !== "/portal" ? `?next=${encodeURIComponent(next)}` : ""}`, { replace: true });
  }, [navigate]);

  const load = React.useCallback(async () => {
    if (!portalSession.access() && !(await refreshPortalSession())) {
      setStatus({ state: "out" });
      return;
    }
    try {
      const me = await portalMe();
      setStatus({ state: "in", me });
      // Keep the greeting current — a name staff corrected, a company renamed.
      if (portalSession.trusted()) {
        portalSession.remember({
          email: me.portal_user.email,
          firstName: firstNameOf(me.portal_user.full_name),
          company: me.company ? me.company.name : null,
        });
      }
    } catch {
      setStatus({ state: "out" });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (status.state === "out") toSignIn();
  }, [status.state, toSignIn]);

  React.useEffect(() => {
    const onOut = () => setStatus({ state: "out" });
    window.addEventListener(PORTAL_SIGNED_OUT, onOut);
    return () => window.removeEventListener(PORTAL_SIGNED_OUT, onOut);
  }, []);

  const signOut = React.useCallback(
    async ({ forget = false }: { forget?: boolean } = {}) => {
      await portalLogout();
      portalSession.clear({ forget });
      navigate("/portal/login", { replace: true });
    },
    [navigate],
  );

  if (status.state !== "in") return <>{splash}</>;
  const me = status.me;
  const kinds = kindsOf(me);
  if (!kinds.length) return <>{noAccess(() => void signOut())}</>;
  const active = kind && kinds.includes(kind) ? kind : kinds[0];
  const grant = me.grants[active];
  const scope: Scope = (active === "CLIENT" && grant.access_scope) || "ALL";
  const value: Ctx = {
    me,
    kind: active,
    scope,
    isAdmin: active === "CLIENT" && grant.is_client_admin === true,
    canOps: scope === "ALL" || scope === "OPERATIONS",
    canBilling: scope === "ALL" || scope === "BILLING",
    firstName: firstNameOf(me.portal_user.full_name),
    company: me.company ? me.company.name : null,
    reloadMe: load,
    signOut,
  };
  return (
    <PortalCtx.Provider value={value}>
      <KindSwitchContext.Provider value={{ kinds, active, setKind }}>{children(value)}</KindSwitchContext.Provider>
    </PortalCtx.Provider>
  );
}

/** One login can hold more than one portal (a client contact who is also on
 *  the board). The account sheet switches between them. */
export const KindSwitchContext = React.createContext<{
  kinds: PortalKind[];
  active: PortalKind | null;
  setKind: (k: PortalKind) => void;
}>({ kinds: [], active: null, setKind: () => {} });
