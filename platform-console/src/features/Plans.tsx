import { useMemo, useState } from "react";
import { platform, can } from "@/lib/api";
import type { Plan } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { money } from "@/lib/format";
import { Button, ConfirmModal, Empty, Field, Loading, Modal, PageHeader } from "@/components/ui";
import { useToast } from "@/components/Toast";

type FeatureRow = { feature_key: string; name?: string; module_key?: string; included: boolean };

export function Plans() {
  const { data, loading, error, reload } = useAsync<Plan[]>(() => platform.plans() as Promise<Plan[]>);
  const { fail, toast } = useToast();
  const [edit, setEdit] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const [features, setFeatures] = useState<Plan | null>(null);
  const [del, setDel] = useState<Plan | null>(null);
  const writable = can("plans.write");
  const rows = data || [];

  return (
    <>
      <PageHeader
        title="Plans"
        desc="Subscription plans + the features each includes."
        actions={writable ? <Button variant="primary" onClick={() => setCreating(true)}>+ New plan</Button> : undefined}
      />
      {loading ? <Loading /> : error ? <Empty>Couldn’t load plans — {error.message}</Empty> : rows.length === 0 ? (
        <Empty>No plans defined.</Empty>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Setup (XAF)</th><th>Yearly (XAF)</th><th>Features</th><th>Tenants</th><th></th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.code}>
                  <td><span className="mono">{p.code}</span></td>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td className="dim">{money(p.price_setup_xaf as number)}</td>
                  <td className="dim">{money(p.price_yearly_xaf as number)}</td>
                  <td className="dim">{Number(p.included_features ?? 0)}</td>
                  <td className="dim">{Number(p.tenant_count ?? 0)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {writable && <Button size="sm" onClick={() => setFeatures(p)}>Features</Button>}
                    {writable && <Button size="sm" variant="ghost" style={{ marginLeft: 6 }} onClick={() => setEdit(p)}>Edit</Button>}
                    {writable && <Button size="sm" variant="danger" style={{ marginLeft: 6 }} onClick={() => setDel(p)}>Delete</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || edit) && (
        <PlanForm
          plan={edit}
          onClose={() => { setCreating(false); setEdit(null); }}
          onSaved={() => { setCreating(false); setEdit(null); reload(); }}
        />
      )}
      {features && <FeatureEditor plan={features} onClose={() => setFeatures(null)} onSaved={() => { setFeatures(null); reload(); }} />}
      {del && (
        <DeletePlan
          plan={del}
          plans={rows}
          onClose={() => setDel(null)}
          onDone={() => { setDel(null); reload(); }}
          fail={fail}
          toast={toast}
        />
      )}
    </>
  );
}

function PlanForm({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const { toast, fail } = useToast();
  const editing = !!plan;
  const [code, setCode] = useState(plan?.code || "");
  const [name, setName] = useState(plan?.name || "");
  const [setup, setSetup] = useState(String(plan?.price_setup_xaf ?? 0));
  const [yearly, setYearly] = useState(String(plan?.price_yearly_xaf ?? 0));
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      if (editing) {
        await platform.updatePlan(String(plan!.plan_id ?? plan!.code), { name: name.trim(), price_setup_xaf: Number(setup) || 0, price_yearly_xaf: Number(yearly) || 0 });
        toast("Plan updated");
      } else {
        await platform.createPlan({ code: code.trim(), name: name.trim(), price_setup_xaf: Number(setup) || 0, price_yearly_xaf: Number(yearly) || 0 });
        toast("Plan created");
      }
      onSaved();
    } catch (e) { fail(e); setBusy(false); }
  }

  return (
    <Modal
      title={editing ? `Edit ${plan!.code}` : "New plan"}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy} disabled={(!editing && !code) || !name}>{editing ? "Save" : "Create"}</Button></>}
    >
      <div className="stack" style={{ gap: 13 }}>
        {!editing && <Field label="Code" hint="lowercase identifier, e.g. 'growth'"><input value={code} onChange={(e) => setCode(e.target.value)} /></Field>}
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Setup price (XAF)"><input type="number" min="0" value={setup} onChange={(e) => setSetup(e.target.value)} /></Field>
        <Field label="Yearly price (XAF)"><input type="number" min="0" value={yearly} onChange={(e) => setYearly(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function FeatureEditor({ plan, onClose, onSaved }: { plan: Plan; onClose: () => void; onSaved: () => void }) {
  const id = String(plan.plan_id ?? plan.code);
  const { data, loading } = useAsync<FeatureRow[]>(() => platform.planFeatures(id) as Promise<FeatureRow[]>, [id]);
  const { toast, fail } = useToast();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const rows = data || [];
  const included = (r: FeatureRow) => (r.feature_key in overrides ? overrides[r.feature_key] : r.included);
  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    return f ? rows.filter((r) => [r.feature_key, r.name, r.module_key].some((x) => String(x || "").toLowerCase().includes(f))) : rows;
  }, [rows, q]);

  async function save() {
    setBusy(true);
    try {
      const features = rows.map((r) => ({ feature_key: r.feature_key, included: included(r) }));
      const res = await platform.setPlanFeatures(id, features) as { reprojected?: number };
      toast(`Saved${res?.reprojected ? ` · re-projected ${res.reprojected} tenant(s)` : ""}`);
      onSaved();
    } catch (e) { fail(e); setBusy(false); }
  }

  return (
    <Modal
      title={`Features · ${plan.name}`}
      onClose={onClose}
      maxWidth={620}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={save} loading={busy}>Save features</Button></>}
    >
      <input className="search" placeholder="Filter features…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10, width: "100%" }} />
      {loading ? <Loading /> : (
        <div style={{ maxHeight: 380, overflow: "auto" }}>
          <table>
            <thead><tr><th>Feature</th><th>Module</th><th style={{ textAlign: "right" }}>Included</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.feature_key}>
                  <td><div style={{ fontWeight: 600 }}>{r.name || r.feature_key}</div><div className="mono muted">{r.feature_key}</div></td>
                  <td className="mono dim">{r.module_key || "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <input type="checkbox" checked={included(r)} onChange={(e) => setOverrides((o) => ({ ...o, [r.feature_key]: e.target.checked }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Saving re-projects feature_state for every tenant on this plan.</p>
    </Modal>
  );
}

function DeletePlan({ plan, plans, onClose, onDone, fail, toast }: { plan: Plan; plans: Plan[]; onClose: () => void; onDone: () => void; fail: (e: unknown) => void; toast: (m: string) => void }) {
  const inUse = Number(plan.tenant_count ?? 0) > 0;
  const others = plans.filter((p) => p.code !== plan.code);
  const [replacement, setReplacement] = useState(others[0]?.code || "");

  const confirm = async () => {
    try {
      await platform.deletePlan(String(plan.plan_id ?? plan.code), inUse ? replacement : undefined);
      toast(`Plan ${plan.code} deleted`);
      onDone();
    } catch (e) { fail(e); }
  };

  return (
    <ConfirmModal
      title={`Delete plan '${plan.code}'?`}
      danger
      confirmLabel="Delete"
      onClose={onClose}
      onConfirm={confirm}
      body={inUse ? (
        <div className="stack" style={{ gap: 10 }}>
          <div>{Number(plan.tenant_count)} tenant(s) are on this plan. Move them to:</div>
          <select value={replacement} onChange={(e) => setReplacement(e.target.value)} style={{ width: "auto" }}>
            {others.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
          </select>
          <div className="muted" style={{ fontSize: 12 }}>They’ll be re-projected onto the replacement plan.</div>
        </div>
      ) : <>This plan has no tenants and will be removed.</>}
    />
  );
}
