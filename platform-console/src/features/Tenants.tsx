import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { platform } from "@/lib/api";
import type { Plan, TenantListRow } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { Button, Empty, Field, Loading, Modal, PageHeader, Pill, StatusPill } from "@/components/ui";
import { useToast } from "@/components/Toast";

export function Tenants() {
  const nav = useNavigate();
  const { data, loading, error, reload } = useAsync<TenantListRow[]>(() => platform.tenants() as Promise<TenantListRow[]>);
  const [q, setQ] = useState("");
  const [showProvision, setShowProvision] = useState(false);

  const rows = data || [];
  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter((r) => [r.display_name, r.slug, r.subdomain, r.plan].some((x) => String(x || "").toLowerCase().includes(f)));
  }, [rows, q]);

  return (
    <>
      <PageHeader
        title="Tenants"
        desc="Every provisioned workspace in this platform registry."
        actions={<Button variant="primary" onClick={() => setShowProvision(true)}>+ Provision tenant</Button>}
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <Empty>Couldn’t load tenants — {error.message}</Empty>
      ) : rows.length === 0 ? (
        <Empty>No tenants provisioned yet.</Empty>
      ) : (
        <>
          <div className="toolbar">
            <input className="search" placeholder="Search name, slug, subdomain…" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="muted">{shown.length} of {rows.length}</span>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tenant</th><th>Subdomain</th><th>Plan</th><th>Status</th><th>Capacity</th><th>Sandbox wipe</th><th>Overrides</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.slug} className="clk" onClick={() => nav("/tenants/" + r.slug)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.display_name || r.slug}</div>
                      <div className="mono muted">{r.slug}</div>
                    </td>
                    <td className="mono dim">{r.subdomain || "—"}</td>
                    <td>{r.plan ? <Pill tone="mute">{r.plan}</Pill> : "—"}</td>
                    <td><StatusPill status={r.status} isLive={r.is_live} /></td>
                    <td>{r.capacity_tier ? <code className="tag">{r.capacity_tier}</code> : "—"}</td>
                    <td className="dim">{r.sandbox_wipe_days != null ? r.sandbox_wipe_days + " days" : "—"}</td>
                    <td className="dim">{r.overrides || 0}</td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr><td colSpan={7} className="empty">No matches.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {showProvision && (
        <ProvisionModal
          onClose={() => setShowProvision(false)}
          onDone={(slug) => { setShowProvision(false); reload(); nav("/tenants/" + slug); }}
        />
      )}
    </>
  );
}

function ProvisionModal({ onClose, onDone }: { onClose: () => void; onDone: (slug: string) => void }) {
  const { toast } = useToast();
  const { data: plans } = useAsync<Plan[]>(() => platform.plans() as Promise<Plan[]>);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [plan, setPlan] = useState("full");
  const [subdomain, setSubdomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    const body: { slug: string; name: string; plan?: string; subdomain?: string } = { slug: slug.trim(), name: name.trim(), plan };
    if (subdomain.trim()) body.subdomain = subdomain.trim();
    try {
      await platform.provision(body);
      toast("Tenant '" + body.slug + "' provisioned");
      onDone(body.slug);
    } catch (e) {
      const anyE = e as { message?: string; fields?: Record<string, string[]> };
      let msg = anyE.message || "Provision failed";
      if (anyE.fields) msg += " — " + Object.entries(anyE.fields).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`).join("; ");
      setErr(msg);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Provision tenant"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!slug || !name}>Provision</Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 13 }}>
        <Field label="Slug" hint="lowercase letters/digits/underscore, starts with a letter — becomes the schema & subdomain.">
          <input placeholder="acme" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field label="Display name">
          <input placeholder="Acme Logistics SARL" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Plan">
          <select value={plan} onChange={(e) => setPlan(e.target.value)}>
            {(plans && plans.length ? plans.map((p) => p.code) : ["full"]).map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </Field>
        <Field label="Subdomain (optional)">
          <input placeholder="acme.praxisls.com" value={subdomain} onChange={(e) => setSubdomain(e.target.value)} />
        </Field>
        {err && <div className="pill bad">{err}</div>}
      </div>
    </Modal>
  );
}
