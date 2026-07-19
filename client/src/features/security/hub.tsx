/**
 * Security & access — the hub shell, mirroring FinanceHub: a posture overview at
 * /security, and every IAM screen as a tab at /security/<section>.
 *
 * The old standalone routes (/security/users, /security/roles, …) resolve here
 * unchanged, so existing nav entries, bookmarks and ⌘K palette hits keep working —
 * they're now hub sections rather than separate screens.
 *
 * Access = Role × Capability × Scope × CRUD-per-module × field visibility, so the
 * overview reads as a posture summary across exactly those axes.
 */
import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { useList } from "@/lib/use-resource";
import { num, dateFmt } from "@/lib/format";
import { UsersPage, RolesPage, CapabilitiesPage, ScopesPage, FieldVisibilityPage, SessionsPage, type User, type Role } from "./pages";
import { PermissionMatrixPage } from "./permission-matrix-page";
import { MySecurityPage } from "./my-security";

const shell = "mx-auto max-w-6xl animate-fade-in";

type TabDef = { slug: string; label: string; Component: React.ComponentType };

const TABS: TabDef[] = [
  { slug: "users", label: "Users", Component: UsersPage },
  { slug: "roles", label: "Roles", Component: RolesPage },
  { slug: "permissions", label: "Permission matrix", Component: PermissionMatrixPage },
  { slug: "capabilities", label: "Capabilities", Component: CapabilitiesPage },
  { slug: "scopes", label: "Scopes", Component: ScopesPage },
  { slug: "field-visibility", label: "Field visibility", Component: FieldVisibilityPage },
  { slug: "sessions", label: "Sessions", Component: SessionsPage },
  { slug: "my-security", label: "My security", Component: MySecurityPage },
];

const BY_SLUG: Record<string, TabDef> = Object.fromEntries(TABS.map((t) => [t.slug, t]));

/** Tab bar rendered by the shell — the pages own their own headers below it. */
function HubTabBar({ active }: { active: string | null }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto mb-4 max-w-6xl">
      <div className="micro mb-2">Hub › Security &amp; access</div>
      <div aria-label="Security sections" className="inline-flex flex-wrap gap-1 rounded-xl border bg-muted p-1">
        <button
          onClick={() => navigate("/security")}
          className={
            active === null
              ? "whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm"
              : "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          }
        >
          Overview
        </button>
        {TABS.map((t) => (
          <button
            key={t.slug}
            onClick={() => navigate(`/security/${t.slug}`)}
            className={
              active === t.slug
                ? "whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm"
                : "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            }
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Horizontal proportion bar — one segment per status. */
function Bar({ parts }: { parts: { label: string; value: number; tone: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="space-y-3">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-[rgb(var(--ink-3)/0.15)]">
        {parts.map((p) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: `rgb(var(${p.tone}))` }} />
        ))}
      </div>
      <ul className="space-y-2 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `rgb(var(${p.tone}))` }} />
              <span className="text-muted-foreground">{p.label}</span>
            </span>
            <span className="num font-medium">{num(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <div className="micro mb-4 uppercase tracking-wide">{subtitle}</div>
      {children}
    </div>
  );
}

function Overview() {
  const navigate = useNavigate();
  const users = useList<User>("/users");
  const roles = useList<Role>("/roles");
  const sessions = useList<{ session_id: string; created_at?: string | null; ip?: string | null; revoked_at?: string | null }>("/sessions/mine");
  const fieldVis = useList<{ field_visibility_id: string }>("/field-visibility");

  const all = users.rows || [];
  const active = all.filter((u) => String(u.status || "").toUpperCase() === "ACTIVE").length;
  const suspended = all.filter((u) => String(u.status || "").toUpperCase() === "SUSPENDED").length;
  const locked = all.filter((u) => String(u.status || "").toUpperCase() === "LOCKED").length;
  const twofa = all.filter((u) => u.is_2fa_enabled).length;
  const twofaPct = all.length ? Math.round((twofa / all.length) * 100) : 0;
  const stale = all.filter((u) => !u.last_login_at).length;

  // 2FA coverage is the one number worth flagging — everything else is a count.
  const coverageTone = twofaPct >= 80 ? "ok" : twofaPct >= 40 ? "warn" : "bad";

  return (
    <section className={shell}>
      <header className="mb-5 border-b border-border pb-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Security &amp; access</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Access is data, not code: role × capability × scope × CRUD-per-module × field visibility. Identity resolves against the live
          schema, so these rows are the same under both LIVE and TEST.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {TABS.slice(0, 6).map((t) => (
              <button
                key={t.slug}
                onClick={() => navigate(`/security/${t.slug}`)}
                className="rounded-full border border-border px-3 py-1 text-[13px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                {t.label}
              </button>
            ))}
          </div>
          <Button onClick={() => navigate("/security/users")}>Manage users</Button>
        </div>
      </header>

      <KpiRow>
        <KpiTile label="Users" value={num(all.length)} hint={`${active} active`} />
        <KpiTile label="Roles" value={num((roles.rows || []).length)} hint={`${(roles.rows || []).filter((r) => !r.is_system).length} tenant-defined`} />
        <KpiTile label="2FA coverage" value={all.length ? `${twofaPct}%` : "—"} hint={`${twofa} of ${all.length} enrolled`} />
        <KpiTile label="Masking rules" value={num((fieldVis.rows || []).length)} hint="Confidential fields" />
      </KpiRow>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Panel title="Account posture" subtitle="Who can sign in right now">
          <Bar
            parts={[
              { label: "Active", value: active, tone: "--ok" },
              { label: "Suspended", value: suspended, tone: "--warn" },
              { label: "Locked", value: locked, tone: "--bad" },
            ]}
          />
          {stale > 0 && (
            <div className="mt-4 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
              <span className="num font-medium text-foreground">{num(stale)}</span> account{stale === 1 ? " has" : "s have"} never signed in.
            </div>
          )}
        </Panel>

        <Panel title="Two-factor authentication" subtitle="Enrolment across tenant users">
          <div className="flex items-center gap-5">
            <div className="relative h-28 w-28 shrink-0 rounded-full" style={{ background: `conic-gradient(rgb(var(--${coverageTone})) ${twofaPct}%, rgb(var(--ink-3) / 0.15) ${twofaPct}%)` }}>
              <div className="absolute inset-[18%] flex flex-col items-center justify-center rounded-full bg-card">
                <span className="num text-xl font-semibold">{twofaPct}%</span>
                <span className="micro">enrolled</span>
              </div>
            </div>
            <div className="flex-1 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Enrolled</span>
                <span className="num font-medium">{num(twofa)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Not enrolled</span>
                <span className="num font-medium">{num(all.length - twofa)}</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate("/security/my-security")}>Set up mine</Button>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="My active sessions" subtitle="Revoking invalidates the refresh token immediately">
        {sessions.error ? (
          <span className="micro">{sessions.error}</span>
        ) : (sessions.rows || []).length === 0 ? (
          <span className="micro">No other active sessions.</span>
        ) : (
          <ul className="space-y-2 text-sm">
            {(sessions.rows || []).slice(0, 5).map((s) => (
              <li key={s.session_id} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0">
                <span className="flex items-center gap-2">
                  {s.revoked_at ? <Pill tone="bad">Revoked</Pill> : <Pill tone="ok">Active</Pill>}
                  <span className="num text-muted-foreground">{s.ip || "unknown IP"}</span>
                </span>
                <span className="num text-muted-foreground">{dateFmt(s.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <Button size="sm" variant="outline" onClick={() => navigate("/security/sessions")}>All sessions</Button>
        </div>
      </Panel>
    </section>
  );
}

export function SecurityHub() {
  const { section } = useParams();
  const tab = section ? BY_SLUG[section] : null;
  // An unknown section falls back to the overview rather than a blank screen.
  const active = tab ? tab.slug : null;
  const Active = tab?.Component;

  return (
    <div className="animate-fade-in">
      <HubTabBar active={active} />
      {Active ? <div key={active}><Active /></div> : <Overview />}
    </div>
  );
}
