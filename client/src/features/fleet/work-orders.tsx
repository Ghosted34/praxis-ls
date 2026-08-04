/**
 * Work orders — maintenance workstation (replaces the CRUD table). A job moves
 * OPEN → IN_PROGRESS → DONE; parts (spares + labour) are logged line by line and
 * the work-order cost rolls up to the sum of its parts.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { DocButton } from "@/components/doc-button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { StepBar, StatusActionBar, LineTable, type Transition } from "@/components/ui/workflow";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt, enumLabel } from "@/lib/format";
import * as api from "@/lib/fleet-api";

const shell = pageShell.wide;
const STATUS_TONE: Record<string, Tone> = { OPEN: "blue", IN_PROGRESS: "warn", DONE: "ok", CANCELLED: "bad" };
const TRANSITIONS: Record<string, string[]> = { OPEN: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["DONE", "CANCELLED"], DONE: [], CANCELLED: [] };
const STATUS_LABEL: Record<string, string> = { IN_PROGRESS: "Start work", DONE: "Complete", CANCELLED: "Cancel" };

function WorkOrderDetail({ order: initial, onClose, onChanged }: { order: api.WorkOrder; onClose: () => void; onChanged: () => void }) {
  const [order, setOrder] = React.useState(initial);
  const parts = useResource(() => api.getWorkOrderParts(order.work_order_id), [order.work_order_id]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [p, setP] = React.useState({ label: "", qty: "1", unit_cost: "" });
  const canEdit = ["OPEN", "IN_PROGRESS"].includes(order.status);

  async function toState(s: string) {
    setBusy("st:" + s); setError(null);
    try { setOrder(await api.setWorkOrderStatus(order.work_order_id, s)); onChanged(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }
  async function addPart(e: React.FormEvent) {
    e.preventDefault(); if (!p.label) return; setBusy("add"); setError(null);
    try {
      const updated = await api.addWorkOrderPart(order.work_order_id, { label: p.label, qty: Number(p.qty) || 1, unit_cost: Number(p.unit_cost) || 0 });
      setOrder((o) => ({ ...o, cost: updated.cost }));
      setP({ label: "", qty: "1", unit_cost: "" }); parts.reload(); onChanged();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }

  const rows = parts.data || [];
  const transitions: Transition[] = (TRANSITIONS[order.status] || []).map((s) => ({
    to: s,
    label: STATUS_LABEL[s] || s,
    variant: s === "CANCELLED" ? "outline" : "default",
  }));

  return (
    <Modal open onClose={onClose} size="xl" title={`${enumLabel(order.kind)} · ${order.registration || order.work_order_id.slice(0, 8)}`} description={order.description || undefined}>
      <div className="space-y-5">
        <StepBar steps={["OPEN", "IN_PROGRESS", "DONE"]} current={order.status} />
        <StatusActionBar status={order.status} tone={STATUS_TONE[order.status]} transitions={transitions} onTransition={toState} busyKey={busy}>
          <span className="text-sm text-muted-foreground">Cost <span className="num font-medium text-foreground">{money(order.cost)}</span></span>
          <DocButton docType="WORK_ORDER" id={order.work_order_id} title={`Work order ${order.registration || order.work_order_id.slice(0, 8)}`} label="View document" />
        </StatusActionBar>

        {error && <ErrorState message={error} />}

        <LineTable
          rows={rows}
          loading={parts.loading}
          empty="No parts logged yet."
          rowKey={(r) => r.work_order_part_id}
          columns={[
            { label: "Part / labour", render: (r) => r.label },
            { label: "Qty", align: "right", render: (r) => <span className="num">{num(r.qty)}</span> },
            { label: "Unit cost", align: "right", render: (r) => <span className="num">{money(r.unit_cost)}</span> },
            { label: "Line total", align: "right", render: (r) => <span className="num">{money(Number(r.qty) * Number(r.unit_cost))}</span> },
          ]}
        />

        {canEdit && (
          <form onSubmit={addPart} className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-[1fr_90px_130px_auto] sm:items-end">
            <Field label="Part / labour"><Input value={p.label} onChange={(e) => setP((s) => ({ ...s, label: e.target.value }))} placeholder="Brake pads / 2h labour" /></Field>
            <Field label="Qty"><Input type="number" min="0" step="any" className="num text-right" value={p.qty} onChange={(e) => setP((s) => ({ ...s, qty: e.target.value }))} /></Field>
            <Field label="Unit cost"><Input type="number" min="0" step="any" className="num text-right" value={p.unit_cost} onChange={(e) => setP((s) => ({ ...s, unit_cost: e.target.value }))} /></Field>
            <Button type="submit" loading={busy === "add"} disabled={!p.label}>Add</Button>
          </form>
        )}
      </div>
    </Modal>
  );
}

function NewWorkOrderForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const vehicles = useResource(() => api.listVehicles(), []);
  const [f, setF] = React.useState({ vehicle_id: "", kind: "CORRECTIVE", description: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.createWorkOrder({ vehicle_id: f.vehicle_id || undefined, kind: f.kind, description: f.description || undefined }); onSaved(); onClose(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New work order" description="Open a maintenance job against a vehicle.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Vehicle">
          <Select value={f.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)}>
            <option value="">—</option>
            {(vehicles.data || []).map((v) => <option key={v.vehicle_id} value={v.vehicle_id}>{v.registration || v.vehicle_id.slice(0, 8)}</option>)}
          </Select>
        </Field>
        <Field label="Kind" required>
          <Select value={f.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="CORRECTIVE">Corrective</option>
            <option value="PREVENTIVE">Preventive</option>
          </Select>
        </Field>
        <Field label="Description"><Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What needs doing" /></Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Open work order</Button>
        </div>
      </form>
    </Modal>
  );
}

export function WorkOrdersPage() {
  const orders = useResource(() => api.listWorkOrders(), []);
  const [view, setView] = React.useState<api.WorkOrder | null>(null);
  const [creating, setCreating] = React.useState(false);

  const cols: Column<api.WorkOrder>[] = [
    { key: "veh", label: "Vehicle", render: (o) => <span className="num font-medium text-foreground">{o.registration || "—"}</span> },
    { key: "kind", label: "Kind", render: (o) => <span className="text-muted-foreground">{enumLabel(o.kind)}</span> },
    { key: "desc", label: "Description", render: (o) => <span className="text-muted-foreground">{o.description || "—"}</span> },
    { key: "status", label: "Status", render: (o) => <Pill tone={STATUS_TONE[o.status] || "mute"}>{enumLabel(o.status)}</Pill> },
    { key: "cost", label: "Cost", className: "text-right", render: (o) => <span className="num">{money(o.cost)}</span> },
    { key: "opened", label: "Opened", render: (o) => <span className="num text-muted-foreground">{dateFmt(o.opened_on)}</span> },
    { key: "_a", label: "", render: (o) => <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => setView(o)}>Open</Button></div> },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Fleet" to="/fleet" />} title="Work orders" description="Log maintenance jobs, parts and labour; cost rolls up from the parts." action={<Button onClick={() => setCreating(true)}>New work order</Button>} />
      <HubTabs />
      <DataList columns={cols} rows={orders.data} error={orders.error} loading={orders.loading} rowKey={(o) => o.work_order_id} empty={{ title: "No work orders", hint: "Open one to start logging maintenance." }} />
      {view && <WorkOrderDetail order={view} onClose={() => setView(null)} onChanged={orders.reload} />}
      {creating && <NewWorkOrderForm onClose={() => setCreating(false)} onSaved={orders.reload} />}
      <ScreenAi path="fleet/work-orders" />
    </section>
  );
}

export default WorkOrdersPage;
