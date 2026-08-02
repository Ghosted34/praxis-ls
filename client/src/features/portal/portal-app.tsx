/**
 * The EXTERNAL client portal — everything under /client-portal.
 *
 * NOT `/portal`: the staff grant-management screen already owns `/portal/access`.
 * Sharing a prefix would put an authentication boundary at the mercy of React
 * Router's route ranking, which is a bad place for one.
 *
 * WHY IT LIVES IN THIS APP. It reuses the branding, tokens and UI primitives the
 * staff client already resolves per host, so a tenant's portal looks like their
 * portal with no second build, second deploy or second place to patch a bug. What
 * it does NOT reuse is the auth path: a portal user has no `app_user` row, no
 * role, no capability and no refresh token (see lib/portal-api.ts), so this tree
 * sits OUTSIDE `RequireAuth` and `AppShell` and never renders staff navigation.
 *
 * The isolation rule, stated once: a portal token only reaches portal routes,
 * and a staff session grants nothing here — `PortalGuard` checks the portal token
 * only, and every request goes through `portalApi`, which attaches only the
 * portal token. Neither can borrow the other's credentials by accident.
 */
import * as React from "react";
import { Routes, Route, Navigate, useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useBranding } from "@/app/branding/branding-context";
import {
  portalToken,
  portalLogin,
  portalForgot,
  portalAccept,
  portalMe,
  portalClientView,
  portalInvestorView,
  PortalError,
  type PortalMe,
  type ClientView,
  type InvestorView,
} from "@/lib/portal-api";

const msg = (e: unknown) => (e instanceof PortalError ? e.message : "Something went wrong. Please try again.");

/* ── chrome ─────────────────────────────────────────────────────────────── */

function PortalFrame({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const { branding } = useBranding();
  const name = branding?.name || "Client portal";
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className={`mx-auto flex items-center justify-between px-6 py-4 ${wide ? "max-w-6xl" : "max-w-md"}`}>
          <div className="flex items-center gap-3">
            {branding?.logoUrl ? (
              <img src={branding.logoUrl} alt="" className="h-8 w-auto" />
            ) : (
              <span className="font-display text-lg text-foreground">{name}</span>
            )}
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Client portal</span>
          </div>
          {wide ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                portalToken.clear();
                window.location.assign("/client-portal/login");
              }}
            >
              Sign out
            </Button>
          ) : null}
        </div>
      </header>
      <main className={`mx-auto px-6 py-10 ${wide ? "max-w-6xl" : "max-w-md"}`}>{children}</main>
      <footer className="px-6 pb-10 text-center text-xs text-muted-foreground">
        Powered by JBS Praxis LLC
      </footer>
    </div>
  );
}

/* ── sign in ────────────────────────────────────────────────────────────── */

function PortalLogin() {
  const nav = useNavigate();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await portalLogin(email.trim(), password);
      portalToken.set(r.access_token);
      nav("/client-portal", { replace: true });
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!email.trim()) return setError("Enter your email address first.");
    setBusy(true);
    setError(null);
    try {
      await portalForgot(email.trim());
      // Always the same message: the endpoint deliberately doesn't reveal whether
      // an address is registered, and the UI must not undo that.
      setSent(true);
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalFrame>
      <h1 className="font-display text-2xl text-foreground">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Track your shipments, documents and invoices.
      </p>

      {sent ? (
        <p className="mt-6 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          If that address has portal access, we've sent a link to set a new password. It can only be used once.
        </p>
      ) : null}

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm text-foreground" htmlFor="portal-email">Email</label>
          <Input id="portal-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-sm text-foreground" htmlFor="portal-password">Password</label>
          <Input id="portal-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error ? <p className="text-sm text-[hsl(var(--bad))]">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <button type="button" onClick={forgot} className="w-full text-sm text-muted-foreground transition-colors hover:text-primary">
          Forgot your password?
        </button>
      </form>
    </PortalFrame>
  );
}

/* ── set password (invite + reset land here) ────────────────────────────── */

function PortalSetPassword() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords don't match.");
    if (password.length < 8) return setError("Use at least 8 characters.");
    setBusy(true);
    setError(null);
    try {
      const r = await portalAccept(token, password);
      // Signed straight in: they've just proved control of the mailbox, so
      // bouncing them to a login form to retype what they typed is friction for
      // no security gain.
      portalToken.set(r.access_token);
      nav("/client-portal", { replace: true });
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <PortalFrame>
        <ErrorState message="That link is incomplete. Please use the link exactly as it appears in your email." />
        <p className="mt-4 text-sm">
          <Link to="/client-portal/login" className="text-primary">Back to sign in</Link>
        </p>
      </PortalFrame>
    );
  }

  return (
    <PortalFrame>
      <h1 className="font-display text-2xl text-foreground">Choose a password</h1>
      <p className="mt-1 text-sm text-muted-foreground">This link can only be used once.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm text-foreground" htmlFor="pw">New password</label>
          <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-sm text-foreground" htmlFor="pw2">Confirm password</label>
          <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {error ? <p className="text-sm text-[hsl(var(--bad))]">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Saving…" : "Set password and continue"}
        </Button>
      </form>
    </PortalFrame>
  );
}

/* ── the portal itself ──────────────────────────────────────────────────── */

const money = (v: string | number | null) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(v);
};
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString() : "—");
const label = (s: string) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-3 font-display text-lg text-foreground">{title}</h2>
      {children}
    </section>
  );
}

/* ── investor terminal ──────────────────────────────────────────────────── */

function Kpi({ label: k, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{k}</p>
      <p className="num mt-2 text-2xl text-foreground">{money(value)}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Line({ label: k, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2 ${strong ? "border-t border-border font-semibold" : ""}`}>
      <span className={strong ? "text-sm text-foreground" : "text-sm text-muted-foreground"}>{k}</span>
      <span className="num text-sm text-foreground">{money(value)}</span>
    </div>
  );
}

function InvestorTerminal({ me }: { me: PortalMe }) {
  const [view, setView] = React.useState<InvestorView | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    portalInvestorView()
      .then((v) => alive && setView(v))
      .catch((e) => alive && setError(msg(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!view) return <SkeletonTable />;

  const { kpis, income_statement: is, balance_sheet: bs, cash_position: cash } = view;

  return (
    <>
      <h1 className="font-display text-2xl text-foreground">
        Financial position{me.portal_user.full_name ? `, ${me.portal_user.full_name.split(" ")[0]}` : ""}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {day(view.period.from)} to {day(view.period.to)} · {view.basis} basis
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Revenue" value={kpis.revenue} hint="Produits for the period" />
        <Kpi label="Net result" value={kpis.net_result} hint="Produits less charges" />
        <Kpi label="Cash on hand" value={kpis.cash_on_hand} hint="Today, not period-end" />
        <Kpi label="Balance sheet total" value={kpis.balance_sheet_total} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Compte de résultat">
          <Line label="Produits" value={is.produits} />
          <Line label="Charges" value={is.charges} />
          {is.hao_net ? <Line label="Hors activités ordinaires (net)" value={is.hao_net} /> : null}
          <Line label="Résultat net" value={is.result} strong />
        </Panel>

        <Panel title="Bilan">
          <Line label="Actif" value={bs.active} />
          <Line label="Passif" value={bs.passif} />
          <Line label="Résultat" value={bs.result} strong />
          {!bs.balanced ? (
            // Shown, not hidden: an unbalanced bilan means the books need
            // attention, and quietly rendering it as though it were final would
            // be the worse of the two failures.
            <p className="mt-2 text-xs text-[hsl(var(--warn))]">
              Actif and passif do not balance for this period — figures are provisional.
            </p>
          ) : null}
        </Panel>

        <Panel title="Cash position">
          {cash.accounts.length === 0 ? (
            <EmptyState title="No treasury accounts" hint="Class-5 balances will appear here." />
          ) : (
            <>
              {cash.accounts.map((a) => (
                <Line key={a.account_code} label={a.account_code} value={a.balance} />
              ))}
              <Line label="Total" value={cash.total_cash} strong />
            </>
          )}
        </Panel>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Read-only summary prepared on the {view.basis} basis. No operational detail is included.
      </p>
    </>
  );
}

/* ── client view ────────────────────────────────────────────────────────── */

function ClientTerminal({ me }: { me: PortalMe }) {
  const [view, setView] = React.useState<ClientView | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    portalClientView()
      .then((v) => alive && setView(v))
      .catch((e) => alive && setError(msg(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <ErrorState message={error} />;

  const dossiers = view?.dossiers ?? [];
  const invoices = view?.invoices ?? [];

  return (
    <>
      <h1 className="font-display text-2xl text-foreground">
        Welcome{me.portal_user.full_name ? `, ${me.portal_user.full_name.split(" ")[0]}` : ""}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {me.grants.CLIENT.expires_at ? `Your access runs to ${day(me.grants.CLIENT.expires_at)}.` : "Your current shipments and invoices."}
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel title="Shipments">
          {!view ? (
            <SkeletonTable />
          ) : dossiers.length === 0 ? (
            <EmptyState title="No shipments yet" hint="New files will appear here as they're opened." />
          ) : (
            <ul className="divide-y divide-border">
              {dossiers.map((d) => (
                <li key={d.dossier_id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{d.ref}</p>
                    <p className="text-xs text-muted-foreground">Opened {day(d.created_at)}</p>
                  </div>
                  <span className="status">{label(d.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Invoices">
          {!view ? (
            <SkeletonTable />
          ) : invoices.length === 0 ? (
            <EmptyState title="Nothing outstanding" hint="Issued invoices will appear here." />
          ) : (
            <ul className="divide-y divide-border">
              {invoices.map((i) => (
                <li key={i.invoice_id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{i.doc_number || "—"}</p>
                    <p className="text-xs text-muted-foreground">Due {day(i.payment_due_on)}</p>
                  </div>
                  <div className="text-right">
                    <p className="num text-sm text-foreground">{money(i.total_ttc)}</p>
                    <span className="status">{label(i.status)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

/**
 * Routes a signed-in portal user to whichever terminal their grant allows.
 *
 * A single login can legitimately hold more than one grant (a CFO who is both a
 * client contact and on the board), so this picks CLIENT first — the everyday
 * case — and offers a switch rather than guessing. AUDITOR is deliberately absent:
 * `auditorView` is still a backend placeholder, so a login holding only an auditor
 * grant is told the room isn't open rather than shown one report dressed up as a
 * portal.
 */
function PortalHome() {
  const [me, setMe] = React.useState<PortalMe | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<"CLIENT" | "INVESTOR" | null>(null);

  React.useEffect(() => {
    let alive = true;
    portalMe()
      .then((m) => {
        if (!alive) return;
        setMe(m);
        setTab(m.grants.CLIENT?.allowed ? "CLIENT" : m.grants.INVESTOR?.allowed ? "INVESTOR" : null);
      })
      .catch((e) => alive && setError(msg(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <PortalFrame wide><ErrorState message={error} /></PortalFrame>;
  if (!me) return <PortalFrame wide><SkeletonTable /></PortalFrame>;

  const both = me.grants.CLIENT?.allowed && me.grants.INVESTOR?.allowed;

  // A login can exist with no usable grant — revoked, expired, or auditor-only.
  // Say so plainly instead of rendering empty tables, which would read as "you
  // have no shipments" and send them to the wrong person for help.
  if (!tab) {
    return (
      <PortalFrame wide>
        <EmptyState
          title="No active access"
          hint={
            me.grants.AUDITOR?.allowed
              ? "The audit room isn't available yet. Please contact your engagement lead."
              : "Your access has expired or been withdrawn. Please contact your account manager."
          }
        />
      </PortalFrame>
    );
  }

  return (
    <PortalFrame wide>
      {both ? (
        <div className="mb-6 inline-flex rounded-full border border-border bg-card p-1">
          {(["CLIENT", "INVESTOR"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "CLIENT" ? "Shipments" : "Financials"}
            </button>
          ))}
        </div>
      ) : null}
      {tab === "CLIENT" ? <ClientTerminal me={me} /> : <InvestorTerminal me={me} />}
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
