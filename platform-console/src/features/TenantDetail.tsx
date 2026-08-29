import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { platform } from "@/lib/api";
import type { AuditRow, FeatureRow, Plan, TenantDatabase, TenantDetail as TDetail } from "@/lib/types";
import { useAsync, type AsyncState } from "@/lib/useAsync";
import { fmtDateTime, humanizeAction } from "@/lib/format";
import { Button, Card, ConfirmModal, Empty, Field, Loading, Modal, Pill, SourcePill, StatusPill } from "@/components/ui";
import { useToast } from "@/components/Toast";

const CAP_TIERS = ["S", "M", "L", "XL"];

type ConfirmSpec = { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; action: () => Promise<unknown> };

export function TenantDetail() {
  const { slug = "" } = useParams();
  const { toast, fail } = useToast();
  const tenant = useAsync<TDetail>(() => platform.tenant(slug) as Promise<TDetail>, [slug]);
  const features = useAsync<FeatureRow[]>(() => platform.features(slug) as Promise<FeatureRow[]>, [slug]);
  const audit = useAsync<AuditRow[]>(() => platform.audit({ tenant: slug, limit: 25 }) as Promise<AuditRow[]>, [slug]);
  const plans = useAsync<Plan[]>(() => platform.plans() as Promise<Plan[]>, []);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);

  const reloadAll = () => { tenant.reload(); features.reload(); audit.reload(); };

  if (tenant.loading) return <Loading />;
  if (tenant.error || !tenant.data) return <Empty>Couldn’t load tenant — {tenant.error?.message}</Empty>;

  const t = tenant.data;
  const db: TenantDatabase = t.database || {};
  const live = !!t.is_live;
  const status = String(t.status || "").toUpperCase();

  const run = (spec: ConfirmSpec) => setConfirm(spec);

  return (
    <>
      <div className="pagehd">
        <Link to="/tenants" className="btn-link">← All tenants</Link>
      </div>

      <div className="between wrap" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22 }}>{t.display_name || t.slug}</h1>
          <div className="row" style={{ gap: 10, marginTop: 6 }}>
            <StatusPill status={t.status} isLive={live} />
            <span className="mono muted">{t.slug}</span>
            {t.plan_code && <Pill tone="mute">{t.plan_code}</Pill>}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8, justifyContent: "flex-end" }}>
          {!live && (
            <Button size="sm" variant="primary" onClick={() => run({
              title: `Take '${t.slug}' live?`, confirmLabel: "Go live",
              body: <>Marks the tenant Live and <b>hides the tenant’s Test/Live toggle</b>. The console can restore it later.</>,
              action: () => platform.goLive(slug).then(() => { toast("Tenant is now live"); reloadAll(); }),
            })}>Go live</Button>
          )}
          {status === "SUSPENDED" ? (
            <Button size="sm" onClick={() => run({
              title: `Resume '${t.slug}'?`, confirmLabel: "Resume",
              body: <>Restores tenant access (status → Live).</>,
              action: () => platform.resume(slug).then(() => { toast("Tenant resumed"); reloadAll(); }),
            })}>Resume</Button>
          ) : (
            <Button size="sm" variant="danger" onClick={() => run({
              title: `Suspend '${t.slug}'?`, danger: true, confirmLabel: "Suspend",
              body: <>Blocks <b>all</b> access for this tenant’s users until resumed.</>,
              action: () => platform.suspend(slug).then(() => { toast("Tenant suspended"); reloadAll(); }),
            })}>Suspend</Button>
          )}
          <Button size="sm" variant="primary" onClick={() => setShowAdmin(true)}>Create admin</Button>
          <Button size="sm" onClick={() => run({
            title: `Migrate '${t.slug}'?`, confirmLabel: "Run migrations",
            body: <>Applies any pending tenant DB migrations to <code className="tag">{db.db_name || t.slug}</code>.</>,
            action: () => platform.migrate(slug).then(() => { toast("Migrations applied"); reloadAll(); }),
          })}>Run migrations</Button>
          <Button size="sm" variant="danger" onClick={() => run({
            title: `Wipe sandbox for '${t.slug}'?`, danger: true, confirmLabel: "Wipe sandbox",
            // The old wording said "truncates … and re-seeds baseline reference
            // data", which reads like a tidy-up. It is a DROP SCHEMA CASCADE:
            // every row anyone put in the sandbox is destroyed and not
            // recoverable from the nightly dump if it was created after 01:00
            // UTC. Say so before the button, not in an incident review after.
            body: <>
              <b>Destroys everything in the sandbox schema</b> — every record anyone has created or
              imported in TEST mode — and rebuilds it empty from the migrations and baseline seeds.
              <br />Live data is untouched. This cannot be undone, and sandbox work created since
              last night&rsquo;s backup is not recoverable.
              <br />The wipe is recorded in the audit trail against your account.
            </>,
            action: () => platform.wipeSandbox(slug).then((r) => {
              const res = r as { audited?: boolean } | null;
              toast(res && res.audited === false
                ? "Sandbox wiped — but the audit row FAILED to write, check the server logs"
                : "Sandbox wiped (recorded in the audit trail)",
                res && res.audited === false ? "bad" : "ok");
              reloadAll();
            }),
          })}>Wipe sandbox</Button>
          <Button size="sm" onClick={() => run({
            title: `Seed sandbox demo for '${t.slug}'?`, confirmLabel: "Seed sandbox",
            body: <>Loads the <b>demo business dataset</b> (employees, clients, dossiers, invoices, containers) into the <b>sandbox</b> schema. Live data is untouched. Idempotent — safe to re-run.</>,
            action: () => platform.seedSandboxDemo(slug).then(() => { toast("Sandbox demo seeded"); reloadAll(); }),
          })}>Seed sandbox demo</Button>
        </div>
      </div>

      <div className="grid2">
        <PlanCard slug={slug} t={t} plans={plans.data || []} onSaved={reloadAll} />
        <CapacityCard slug={slug} db={db} onSaved={reloadAll} />
        <SandboxCard slug={slug} t={t} onSaved={reloadAll} />
      </div>

      <DomainsCard slug={slug} t={t} onSaved={reloadAll} />

      <div style={{ marginTop: 16 }}>
        <FeaturesCard slug={slug} state={features} />
      </div>

      <div style={{ marginTop: 16 }}>
        <AuditCard state={audit} />
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onClose={() => setConfirm(null)}
          onConfirm={() => confirm.action().catch(fail)}
        />
      )}

      {showAdmin && <CreateAdminModal slug={slug} onClose={() => setShowAdmin(false)} onDone={() => { setShowAdmin(false); reloadAll(); }} />}
    </>
  );
}

function CreateAdminModal({ slug, onClose, onDone }: { slug: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("CEO");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await platform.createAdmin(slug, { email: email.trim(), name: name.trim() || undefined, password, role });
      toast(`Admin ${email.trim()} created`);
      onDone();
    } catch (e) {
      const anyE = e as { message?: string; fields?: Record<string, string[]> };
      let msg = anyE.message || "Create admin failed";
      if (anyE.fields) msg += " — " + Object.entries(anyE.fields).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`).join("; ");
      setErr(msg);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Create tenant admin"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!email || password.length < 8}>Create admin</Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 13 }}>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Bootstraps a login for <code className="tag">{slug}</code> (live schema). Default role CEO bypasses RBAC so this first user can grant access to everyone else.
        </p>
        <Field label="Email"><input type="email" placeholder="admin@acme.cm" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Full name (optional)"><input placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Password" hint="at least 8 characters"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="Role"><input value={role} onChange={(e) => setRole(e.target.value)} /></Field>
        {err && <div className="pill bad">{err}</div>}
      </div>
    </Modal>
  );
}

function PlanCard({ slug, t, plans, onSaved }: { slug: string; t: TDetail; plans: Plan[]; onSaved: () => void }) {
  const { toast, fail } = useToast();
  const current = String(t.plan_code || "");
  const [plan, setPlan] = useState(current);
  const [busy, setBusy] = useState(false);
  const options = plans.length ? plans.map((p) => p.code) : current ? [current] : [];
  const save = () => {
    if (!plan || plan === current) return;
    setBusy(true);
    platform.setPlan(slug, plan)
      .then(() => { toast("Plan changed to " + plan); onSaved(); })
      .catch(fail).finally(() => setBusy(false));
  };
  return (
    <Card title="Plan">
      <dl className="kv">
        <dt>Current</dt><dd>{current ? <Pill tone="mute">{current}</Pill> : "—"}</dd>
        <dt>Change to</dt>
        <dd className="row" style={{ gap: 8 }}>
          <select value={plan} onChange={(e) => setPlan(e.target.value)} style={{ width: "auto" }}>
            {options.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
          <Button size="sm" onClick={save} loading={busy} disabled={!plan || plan === current}>Change</Button>
        </dd>
      </dl>
      <p className="muted" style={{ margin: "10px 4px 0", fontSize: 12 }}>
        Re-projects the plan’s included features. Per-tenant overrides are kept.
      </p>
    </Card>
  );
}

function CapacityCard({ slug, db, onSaved }: { slug: string; db: TenantDatabase; onSaved: () => void }) {
  const { toast, fail } = useToast();
  const [tier, setTier] = useState(String(db.capacity_tier || "S"));
  const [busy, setBusy] = useState(false);
  const save = () => {
    setBusy(true);
    platform.setCapacity(slug, tier).then(() => { toast("Capacity set to " + tier); onSaved(); }).catch(fail).finally(() => setBusy(false));
  };
  return (
    <Card title="Database & capacity">
      <dl className="kv">
        <dt>DB name</dt><dd className="mono">{String(db.db_name || "—")}</dd>
        <dt>Region</dt><dd>{String(db.region || "—")}</dd>
        <dt>Owned by</dt><dd>{db.tenant_owned ? "Tenant" : "Praxis"}</dd>
        <dt>Capacity tier</dt>
        <dd className="row" style={{ gap: 8 }}>
          <select value={tier} onChange={(e) => setTier(e.target.value)} style={{ width: "auto" }}>
            {CAP_TIERS.map((x) => <option key={x}>{x}</option>)}
          </select>
          <Button size="sm" onClick={save} loading={busy}>Set</Button>
        </dd>
      </dl>
    </Card>
  );
}

/**
 * The tenant's hosts, and what each one serves.
 *
 * A tenant has two stranger-facing addresses. The workspace subdomain
 * (`smartls.praxisls.com`) is where their staff sign in, and where their public
 * site also lives — under /public — until they bring a domain of their own. That
 * domain (`smartls.cm`) is the second, and on it the staff workspace must not be
 * served at all: it is an address their clients visit, and a staff sign-in has
 * no business answering there.
 *
 * That is what `surface` records, per host, and why this card is editable rather
 * than the read-only list it replaced. Before it existed the only way to give a
 * client their own domain was an environment variable on the server — which took
 * a deploy, held exactly one value for the whole platform, and therefore worked
 * for exactly one tenant.
 *
 * What this card does NOT do is DNS or certificates. Marking a host 'public'
 * tells this application what to serve there; the domain still has to point at
 * the server and carry its own certificate, because the *.praxisls.com wildcard
 * covers one label of that domain and nothing of any other.
 */
/**
 * The prefix one host serves the marketing site at.
 *
 * Editable in place rather than behind a modal, because it is one short word and
 * the row it belongs to is the context — a dialog would hide which host it
 * applies to. Saves on blur or Enter, and only when the value actually changed:
 * a click into the field and back out should not write an audit row.
 *
 * Refusals come from the server, which owns the list of prefixes the workspace
 * already answers. Repeating it here would be a second copy, and the one that
 * silently falls behind when a new ERP section is added.
 */
function BaseCell({
  slug, host, value, onSaved,
}: { slug: string; host: string; value: string; onSaved: () => void }) {
  const { toast, fail } = useToast();
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  const save = () => {
    const next = draft.trim().toLowerCase();
    if (!next || next === value) { setDraft(value); return; }
    setBusy(true);
    platform.setDomainBase(slug, host, next)
      .then(() => { toast(`${host} serves its site at ${next.startsWith("/") ? next : "/" + next}`); onSaved(); })
      .catch((e) => { setDraft(value); fail(e); })
      .finally(() => setBusy(false));
  };

  return (
    <input
      className="mono"
      style={{ width: 110 }}
      value={draft}
      disabled={busy}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        // Escape abandons the edit — the only way back to the stored value once
        // you have typed over it, since there is no cancel button on a bare input.
        if (e.key === "Escape") { setDraft(value); (e.target as HTMLInputElement).blur(); }
      }}
      aria-label={`Path prefix for ${host}`}
    />
  );
}

function DomainsCard({ slug, t, onSaved }: { slug: string; t: TDetail; onSaved: () => void }) {
  const { toast, fail } = useToast();
  const [host, setHost] = useState("");
  const [surface, setSurface] = useState<"public" | "erp">("public");
  const [busy, setBusy] = useState<string | null>(null);
  const rows = t.subdomains || [];

  const add = () => {
    const h = host.trim().toLowerCase();
    if (!h) { toast("Enter the hostname the client will use", "bad"); return; }
    setBusy("add");
    platform.addDomain(slug, h, surface)
      .then(() => {
        toast(
          surface === "public"
            ? `${h} added — it serves the public site, not the workspace`
            : `${h} added — it serves the workspace`,
        );
        setHost("");
        onSaved();
      })
      .catch(fail)
      .finally(() => setBusy(null));
  };

  const flip = (h: string, next: "public" | "erp") => {
    setBusy(h);
    platform.setDomainSurface(slug, h, next)
      .then(() => { toast(`${h} now serves the ${next === "public" ? "public site" : "workspace"}`); onSaved(); })
      .catch(fail)
      .finally(() => setBusy(null));
  };

  return (
    <Card title="Domains">
      <div style={{ margin: "-16px -16px 0" }}>
        <table>
          <thead>
            <tr><th>Host</th><th>Serves</th><th>Site lives at</th><th>Primary</th><th /></tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5}><span className="muted">No hosts registered.</span></td></tr>
            )}
            {rows.map((sd, i) => {
              const isPublic = sd.surface === "public";
              return (
                <tr key={i}>
                  <td className="mono">{sd.host}</td>
                  <td>
                    {isPublic
                      ? <Pill tone="info">Public site</Pill>
                      : <Pill tone="mute">Workspace</Pill>}
                  </td>
                  <td>
                    {/* The prefix appears in every URL the tenant prints, so it is
                        theirs to choose — from a bounded set. The server refuses
                        anything the workspace already answers (/settings, /login,
                        every ERP section) and /portal, which invitation emails
                        point at and which never moves. */}
                    <BaseCell
                      slug={slug}
                      host={sd.host}
                      value={sd.public_base || "/public"}
                      onSaved={onSaved}
                    />
                  </td>
                  <td>{sd.is_primary ? <Pill tone="ok">Primary</Pill> : <span className="muted">—</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    {/* The primary host is where staff sign in. Flipping it to the
                        public site would take the workspace off the only address
                        anyone has for it, so it is not offered here. */}
                    {sd.is_primary ? (
                      <span className="muted">—</span>
                    ) : (
                      <Button
                        size="sm"
                        loading={busy === sd.host}
                        onClick={() => flip(sd.host, isPublic ? "erp" : "public")}
                      >
                        {isPublic ? "Serve workspace" : "Serve public site"}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <dl className="kv" style={{ marginTop: 16 }}>
        <dt>Add a domain</dt>
        <dd className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="smartls.cm"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            style={{ width: 220 }}
            className="mono"
          />
          <select value={surface} onChange={(e) => setSurface(e.target.value as "public" | "erp")}>
            <option value="public">serves the public site</option>
            <option value="erp">serves the workspace</option>
          </select>
          <Button size="sm" onClick={add} loading={busy === "add"}>Add</Button>
        </dd>
        <dt>Still needed</dt>
        <dd className="muted">
          DNS pointing at this server, and a TLS certificate for the domain — the
          wildcard does not cover it.
        </dd>
      </dl>
    </Card>
  );
}

function SandboxCard({ slug, t, onSaved }: { slug: string; t: TDetail; onSaved: () => void }) {
  const { toast, fail } = useToast();
  const [days, setDays] = useState(String(t.sandbox_wipe_days ?? 0));
  const [busy, setBusy] = useState(false);
  const save = () => {
    // 0 is the default and means "never" — wipes are manual. Anything above 0
    // hands a destructive job back to the cron, so it is worth typing on purpose.
    const n = parseInt(days, 10);
    if (isNaN(n) || n < 0 || n > 365) { toast("Enter 0 (never) or 1–365 days", "bad"); return; }
    setBusy(true);
    platform.setSandbox(slug, n)
      .then(() => { toast(n === 0 ? "Auto-wipe off — wipes are manual" : "Sandbox auto-wipe → every " + n + " days"); onSaved(); })
      .catch(fail).finally(() => setBusy(false));
  };
  const auto = Number(t.sandbox_wipe_days ?? 0) > 0;
  return (
    <Card title="Sandbox & lifecycle">
      <dl className="kv">
        <dt>Auto-wipe every</dt>
        <dd className="row" style={{ gap: 8 }}>
          <input type="number" min={0} max={365} value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 90 }} />
          <span className="muted">days — 0 = never (manual only)</span>
          <Button size="sm" onClick={save} loading={busy}>Set</Button>
        </dd>
        <dt>Wipe mode</dt>
        <dd>{auto ? <Pill tone="warn">Automatic</Pill> : <Pill tone="mute">Manual</Pill>}</dd>
        <dt>Last wiped</dt>
        <dd>{t.last_sandbox_wipe_at ? fmtDateTime(t.last_sandbox_wipe_at as string) : <span className="muted">never recorded</span>}</dd>
        <dt>Live</dt><dd>{t.is_live ? <Pill tone="info">Yes</Pill> : <Pill tone="mute">No</Pill>}</dd>
        <dt>Created</dt><dd>{fmtDateTime(t.created_at)}</dd>
      </dl>
    </Card>
  );
}

function FeaturesCard({ slug, state }: { slug: string; state: AsyncState<FeatureRow[]> }) {
  const { toast, fail } = useToast();
  const [q, setQ] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const rows = state.data || [];
  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter((r) => [r.feature_key, r.name, r.module_key].some((x) => String(x || "").toLowerCase().includes(f)));
  }, [rows, q]);

  const toggle = (r: FeatureRow) => {
    setBusyKey(r.feature_key);
    platform.setFeature(slug, r.feature_key, r.state === "on" ? "off" : "on")
      .then(() => { toast(`${r.feature_key} → ${r.state === "on" ? "off" : "on"}`); state.reload(); })
      .catch(fail).finally(() => setBusyKey(null));
  };
  const clear = (r: FeatureRow) => {
    setBusyKey(r.feature_key);
    platform.clearFeature(slug, r.feature_key)
      .then(() => { toast("Override cleared for " + r.feature_key); state.reload(); })
      .catch(fail).finally(() => setBusyKey(null));
  };

  return (
    <Card title="Features" actions={<input className="search" placeholder="Filter features…" style={{ maxWidth: 220 }} value={q} onChange={(e) => setQ(e.target.value)} />}>
      <div style={{ margin: -16 }}>
        {state.loading ? <Loading /> : (
          <div className="tbl-wrap" style={{ border: "none" }}>
            <table>
              <thead><tr><th>Feature</th><th>Module</th><th>Source</th><th>State</th><th></th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.feature_key}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.name || r.feature_key}</div>
                      <div className="mono muted">{r.feature_key}</div>
                    </td>
                    <td className="mono dim">{r.module_key || "—"}</td>
                    <td><SourcePill source={r.source} /></td>
                    <td><Pill tone={r.state === "on" ? "ok" : "mute"}>{r.state === "on" ? "On" : "Off"}</Pill></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <Button size="sm" loading={busyKey === r.feature_key} onClick={() => toggle(r)}>
                        {r.state === "on" ? "Turn off" : "Turn on"}
                      </Button>
                      {r.source === "override" && (
                        <Button size="sm" variant="ghost" style={{ marginLeft: 6 }} onClick={() => clear(r)} title="Remove the per-tenant override; revert to plan/default">Clear</Button>
                      )}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={5} className="empty">No matching features.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

function AuditCard({ state }: { state: AsyncState<AuditRow[]> }) {
  const rows = state.data || [];
  return (
    <Card title="Recent platform activity">
      <div style={{ margin: -16 }}>
        {state.loading ? <Loading /> : rows.length === 0 ? (
          <div className="empty">No platform actions recorded for this tenant yet.</div>
        ) : (
          <div className="tbl-wrap" style={{ border: "none" }}>
            <table>
              <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Ref</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.audit_id}>
                    <td className="dim" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(a.created_at)}</td>
                    <td>{humanizeAction(a.action)}</td>
                    <td className="dim">{a.actor_name || a.actor_email || "—"}</td>
                    <td className="mono dim">{a.entity_ref || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
