/**
 * Governance — approval workflows: the chains bound to approvable events.
 *
 * Split out of `features/governance/pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { HubCrumb } from "@/components/tabbed-hub";
import { Pill } from "@/components/ui/pill";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { money, num } from "@/lib/format";
import * as wf from "@/lib/workflow-api";
import { fetchRoles } from "@/lib/rbac";
import { fetchScopeTree, buildScopeTree, type ScopeTreeNode } from "@/lib/scope-api";
import { reportActionError } from "@/lib/action-error";
import { RowActions } from "@/components/ui/row-actions";

function Toggle({ on, busy, onClick }: { on: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy} role="switch" aria-checked={on}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-[rgb(var(--ink-3)/0.3)]"} ${busy ? "opacity-60" : ""}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function band(s: wf.WorkflowStep): string {
  if (s.min_amount_xaf == null && s.max_amount_xaf == null) return "any amount";
  if (s.min_amount_xaf != null && s.max_amount_xaf != null) return `${money(s.min_amount_xaf)} – ${money(s.max_amount_xaf)}`;
  if (s.min_amount_xaf != null) return `≥ ${money(s.min_amount_xaf)}`;
  return `≤ ${money(s.max_amount_xaf)}`;
}

function StepForm({ workflowId, nextSeq, onClose, onSaved }: { workflowId: string; nextSeq: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ step_seq: String(nextSeq), step_kind: "APPROVE", capability_code: "APPROVER", role_id: "", scope_id: "", min_amount_xaf: "", max_amount_xaf: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Who may act on this step. Until these existed, every step built here was
  // saved with role_id = NULL, which meant the task it opened was assigned to
  // nobody and notified nobody (audit finding W1).
  const roles = useResource(() => fetchRoles(), []);
  const scopes = useResource(() => fetchScopeTree(), []);
  const scopeTree = React.useMemo(() => buildScopeTree(scopes.data || []), [scopes.data]);
  const flatScopes = React.useMemo(() => {
    const out: ScopeTreeNode[] = [];
    const walk = (ns: ScopeTreeNode[]) => ns.forEach((n) => { out.push(n); walk(n.children); });
    walk(scopeTree);
    return out;
  }, [scopeTree]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await wf.addStep(workflowId, {
        step_seq: Number(f.step_seq), step_kind: f.step_kind as "VALIDATE" | "APPROVE",
        capability_code: f.capability_code as "VALIDATOR" | "APPROVER",
        role_id: f.role_id || undefined,
        scope_id: f.scope_id || undefined,
        min_amount_xaf: f.min_amount_xaf === "" ? undefined : Number(f.min_amount_xaf),
        max_amount_xaf: f.max_amount_xaf === "" ? undefined : Number(f.max_amount_xaf),
      });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Add step" description="A stage in the chain — who acts, where in the company, and (optionally) the amount band it applies to.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Order" required><Input type="number" min="1" className="num" value={f.step_seq} onChange={(e) => set("step_seq", e.target.value)} /></Field>
          <Field label="Kind" required>
            <Select value={f.step_kind} onChange={(e) => { set("step_kind", e.target.value); set("capability_code", e.target.value === "VALIDATE" ? "VALIDATOR" : "APPROVER"); }}>
              <option value="VALIDATE">Validate</option>
              <option value="APPROVE">Approve</option>
            </Select>
          </Field>
          <Field label="Role" hint="Who decides this step. Leave as Anyone and the step is open to any approver.">
            <Select value={f.role_id} onChange={(e) => set("role_id", e.target.value)}>
              <option value="">Anyone</option>
              {(roles.data || []).map((r) => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
            </Select>
          </Field>
          <Field label="Part of the company" hint="The organigramme node this decision belongs to. Anyone above it in the tree can act; leave blank for company-wide.">
            <Select value={f.scope_id} onChange={(e) => set("scope_id", e.target.value)}>
              <option value="">Company-wide</option>
              {flatScopes.map((s) => (
                <option key={s.scope_id} value={s.scope_id}>{`${"  ".repeat(s.depth)}${s.code} · ${s.name}`}</option>
              ))}
            </Select>
          </Field>
          <Field label="Capability" required hint="Segregation-of-duties overlay — the actor must hold this authority.">
            <Select value={f.capability_code} onChange={(e) => set("capability_code", e.target.value)}>
              <option value="VALIDATOR">Validator</option>
              <option value="APPROVER">Approver</option>
            </Select>
          </Field>
          <div />
          <Field label="Min amount (XAF)"><Input type="number" min="0" className="num text-right" value={f.min_amount_xaf} onChange={(e) => set("min_amount_xaf", e.target.value)} placeholder="Any" /></Field>
          <Field label="Max amount (XAF)"><Input type="number" min="0" className="num text-right" value={f.max_amount_xaf} onChange={(e) => set("max_amount_xaf", e.target.value)} placeholder="Any" /></Field>
        </div>
        {!scopes.loading && !flatScopes.length && (
          <p className="micro">
            No scopes defined yet — build the tree under Security &rsaquo; Scopes to route steps to a branch or department.
          </p>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy}>Add step</Button>
        </div>
      </form>
    </Modal>
  );
}

function WorkflowDrawer({ workflow, onClose, onChanged }: { workflow: wf.Workflow; onClose: () => void; onChanged: () => void }) {
  const steps = useResource(() => wf.listSteps(workflow.workflow_id), [workflow.workflow_id]);
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const chain = (steps.data || []).slice().sort((a, b) => a.step_seq - b.step_seq);

  // Resolve the ids a step binds to into names, so the chain reads as
  // "Finance · Douala branch" rather than two UUIDs the reader can't check.
  const roles = useResource(() => fetchRoles(), []);
  const scopes = useResource(() => fetchScopeTree(), []);
  const roleName = (id?: string | null) =>
    (roles.data || []).find((r) => r.role_id === id)?.name || null;
  const scopeName = (id?: string | null) => {
    const s = (scopes.data || []).find((x) => x.scope_id === id);
    return s ? `${s.code} · ${s.name}` : null;
  };
  const nextSeq = chain.length ? Math.max(...chain.map((s) => s.step_seq)) + 1 : 1;

  async function remove(s: wf.WorkflowStep) {
    setBusy(s.workflow_step_id);
    try { await wf.removeStep(workflow.workflow_id, s.workflow_step_id); steps.reload(); onChanged(); } catch (e) { reportActionError(e); } finally { setBusy(null); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={workflow.name} description={workflow.event_type_key ? `On event: ${workflow.event_type_key}` : undefined}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="micro uppercase tracking-wide">Approval chain</span>
          <Button size="sm" onClick={() => setAdding(true)}>Add step</Button>
        </div>
        {steps.loading ? <div className="py-6 text-center micro">Loading…</div> : steps.error ? <ErrorState message={steps.error} /> : chain.length ? (
          <ol className="space-y-2">
            {chain.map((s) => (
              <li key={s.workflow_step_id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary-ink">{s.step_seq}</span>
                  <Pill tone={s.step_kind === "VALIDATE" ? "blue" : "ok"}>{s.step_kind}</Pill>
                  {/* An unbound step is open to anyone — say so plainly rather than
                      showing a capability that reads like a restriction. */}
                  <span className="text-sm">{roleName(s.role_id) || "Anyone"}</span>
                  <span className="micro">· {scopeName(s.scope_id) || "company-wide"}</span>
                  {s.capability_code && <span className="micro">· {s.capability_code}</span>}
                  <span className="micro">· {band(s)}</span>
                </span>
                <Button size="sm" variant="ghost" loading={busy === s.workflow_step_id} onClick={() => remove(s)}>Remove</Button>
              </li>
            ))}
          </ol>
        ) : <p className="micro">No steps yet — add the first stage of the chain.</p>}
      </div>
      {adding && <StepForm workflowId={workflow.workflow_id} nextSeq={nextSeq} onClose={() => setAdding(false)} onSaved={() => { steps.reload(); onChanged(); }} />}
    </Modal>
  );
}

function WorkflowForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: events } = useList<wf.EventType>("/event-types");
  const approvable = (events || []).filter((e) => e.is_approvable);
  const [f, setF] = React.useState({ name: "", event_type_key: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await wf.createWorkflow({ name: f.name, event_type_key: f.event_type_key }); onSaved(); onClose(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New workflow" description="Bind an approval chain to an approvable event.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Expense approval over 500k" /></Field>
          <Field label="Event" required className="sm:col-span-2">
            <Select value={f.event_type_key} onChange={(e) => set("event_type_key", e.target.value)}>
              <option value="">Select an approvable event…</option>
              {approvable.map((e) => <option key={e.key} value={e.key}>{e.name || e.key}</option>)}
            </Select>
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.name || !f.event_type_key || busy}>Create workflow</Button>
        </div>
      </form>
    </Modal>
  );
}

export function WorkflowsPage() {
  const { rows, error, loading, reload } = useList<wf.Workflow>("/workflows");
  const [creating, setCreating] = React.useState(false);
  const [view, setView] = React.useState<wf.Workflow | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const list = rows || [];

  async function toggleActive(w: wf.Workflow) {
    setBusy(w.workflow_id);
    try { await wf.updateWorkflow(w.workflow_id, { is_active: !w.is_active }); reload(); } catch (e) { reportActionError(e); } finally { setBusy(null); }
  }

  const columns: Column<wf.Workflow>[] = [
    { key: "name", label: "Workflow", render: (w) => <span className="font-medium text-foreground">{w.name}</span> },
    { key: "event", label: "On event", render: (w) => (w.event_type_key ? <Pill tone="mute">{w.event_type_key}</Pill> : "—") },
    { key: "steps", label: "Steps", className: "num text-right", render: (w) => num(w.step_count ?? 0) },
    { key: "active", label: "Active", render: (w) => <Toggle on={!!w.is_active} busy={busy === w.workflow_id} onClick={() => toggleActive(w)} /> },
    { key: "_a", label: "", render: (w) => <RowActions><Button size="sm" variant="outline" onClick={() => setView(w)}>Edit chain</Button></RowActions> },
  ];

  return (
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Governance" to="/governance" />} title="Workflows" description="Validate/approve chains bound to approvable events — the org's approval routing." action={<Button onClick={() => setCreating(true)}>New workflow</Button>} />
      <KpiRow>
        <KpiTile label="Workflows" value={num(list.length)} />
        <KpiTile label="Active" value={num(list.filter((w) => w.is_active).length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(w) => w.workflow_id} onRowClick={(w) => setView(w)} empty={{ title: "No workflows", hint: "Create a chain to route approvals for an event." }} />
      {creating && <WorkflowForm onClose={() => setCreating(false)} onSaved={reload} />}
      {view && <WorkflowDrawer workflow={view} onClose={() => setView(null)} onChanged={reload} />}
    </section>
  );
}

/* ═══════════════════════ Approvals — runtime queue ═══════════════════════ */
