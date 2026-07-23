import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { platform } from "@/lib/api";
import type { AuditRow, FeatureRow, TenantDatabase, TenantDetail as TDetail } from "@/lib/types";
import { useAsync, type AsyncState } from "@/lib/useAsync";
import { fmtDateTime } from "@/lib/format";
import { Button, Card, ConfirmModal, Empty, Loading, Pill, SourcePill, StatusPill } from "@/components/ui";
import { useToast } from "@/components/Toast";

const CAP_TIERS = ["S", "M", "L", "XL"];

type ConfirmSpec = { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; action: () => Promise<unknown> };

export function TenantDetail() {
  const { slug = "" } = useParams();
  const { toast, fail } = useToast();
  const tenant = useAsync<TDetail>(() => platform.tenant(slug) as Promise<TDetail>, [slug]);
  const features = useAsync<FeatureRow[]>(() => platform.features(slug) as Promise<FeatureRow[]>, [slug]);
  const audit = useAsync<AuditRow[]>(() => platform.audit({ tenant: slug, limit: 25 }) as Promise<AuditRow[]>, [slug]);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

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
          <Button size="sm" onClick={() => run({
            title: `Migrate '${t.slug}'?`, confirmLabel: "Run migrations",
            body: <>Applies any pending tenant DB migrations to <code className="tag">{db.db_name || t.slug}</code>.</>,
            action: () => platform.migrate(slug).then(() => { toast("Migrations applied"); reloadAll(); }),
          })}>Run migrations</Button>
          <Button size="sm" variant="danger" onClick={() => run({
            title: `Wipe sandbox for '${t.slug}'?`, danger: true, confirmLabel: "Wipe sandbox",
            body: <>Truncates the <b>sandbox</b> schema and re-seeds baseline reference data. Live data is untouched.</>,
            action: () => platform.wipeSandbox(slug).then(() => { toast("Sandbox wiped"); reloadAll(); }),
          })}>Wipe sandbox</Button>
        </div>
      </div>

      <div className="grid2">
        <CapacityCard slug={slug} db={db} onSaved={reloadAll} />
        <SandboxCard slug={slug} t={t} onSaved={reloadAll} />
      </div>

      {t.subdomains && t.subdomains.length > 0 && (
        <Card title="Subdomains" className="" >
          <div style={{ margin: -16 }}>
            <table>
              <thead><tr><th>Host</th><th>Primary</th></tr></thead>
              <tbody>
                {t.subdomains.map((s, i) => (
                  <tr key={i}>
                    <td className="mono">{s.host}</td>
                    <td>{s.is_primary ? <Pill tone="ok">Primary</Pill> : <Pill tone="mute">—</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

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
    </>
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

function SandboxCard({ slug, t, onSaved }: { slug: string; t: TDetail; onSaved: () => void }) {
  const { toast, fail } = useToast();
  const [days, setDays] = useState(String(t.sandbox_wipe_days ?? 14));
  const [busy, setBusy] = useState(false);
  const save = () => {
    const n = parseInt(days, 10);
    if (!n || n < 1) { toast("Enter a positive number of days", "bad"); return; }
    setBusy(true);
    platform.setSandbox(slug, n).then(() => { toast("Sandbox interval → " + n + " days"); onSaved(); }).catch(fail).finally(() => setBusy(false));
  };
  return (
    <Card title="Sandbox & lifecycle">
      <dl className="kv">
        <dt>Auto-wipe every</dt>
        <dd className="row" style={{ gap: 8 }}>
          <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 90 }} />
          <span className="muted">days</span>
          <Button size="sm" onClick={save} loading={busy}>Set</Button>
        </dd>
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
                    <td><span className="mono">{a.action}</span></td>
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
