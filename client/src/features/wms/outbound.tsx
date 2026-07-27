/**
 * Outbound — pick/pack/dispatch workstation (replaces the CRUD table). An order
 * moves CREATED → Picking → Packed → Dispatched; its lines are picked and packed
 * item by item. (Stock is decremented by the inventory move journal.)
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { StepBar, StatusActionBar, LineTable, type Transition } from "@/components/ui/workflow";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, errMsg } from "@/lib/use-resource";
import { num, dateFmt } from "@/lib/format";
import * as api from "@/lib/wms-api";

const shell = "mx-auto max-w-6xl animate-fade-in";
const STATUS_TONE: Record<string, Tone> = { CREATED: "mute", PICKING: "blue", PACKED: "warn", DISPATCHED: "ok", CANCELLED: "bad" };
const TRANSITIONS: Record<string, string[]> = {
  CREATED: ["PICKING", "CANCELLED"], PICKING: ["PACKED", "CANCELLED"], PACKED: ["DISPATCHED", "CANCELLED"], DISPATCHED: [], CANCELLED: [],
};
const STATUS_LABEL: Record<string, string> = { PICKING: "Start picking", PACKED: "Mark packed", DISPATCHED: "Dispatch", CANCELLED: "Cancel" };

function Toggle({ on, label, doneLabel, disabled, busy, onClick }: { on: boolean; label: string; doneLabel: string; disabled?: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant={on ? "default" : "outline"} loading={busy} disabled={disabled} onClick={onClick}>{on ? doneLabel : label}</Button>
  );
}

function OrderDetail({ order: initial, invMap, inventory, onClose, onChanged }: {
  order: api.OutboundOrder; invMap: Record<string, string>; inventory: api.InventoryItem[]; onClose: () => void; onChanged: () => void;
}) {
  const [order, setOrder] = React.useState(initial);
  const lines = useResource(() => api.getOutboundLines(order.outbound_order_id), [order.outbound_order_id]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [addItem, setAddItem] = React.useState("");
  const [addQty, setAddQty] = React.useState("1");
  const canEditLines = ["CREATED", "PICKING"].includes(order.status);

  async function toState(s: string) {
    setBusy("st:" + s); setError(null);
    try { setOrder(await api.setOutboundStatus(order.outbound_order_id, s)); onChanged(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }
  async function flip(l: api.OutboundLine, key: "picked" | "packed") {
    setBusy(l.outbound_line_id + key); setError(null);
    try { await api.setOutboundLineFlags(order.outbound_order_id, l.outbound_line_id, { [key]: !l[key] }); lines.reload(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }
  async function add(e: React.FormEvent) {
    e.preventDefault(); if (!addItem) return; setBusy("add"); setError(null);
    try { await api.addOutboundLine(order.outbound_order_id, { inventory_item_id: addItem, qty: Number(addQty) || 1 }); setAddItem(""); setAddQty("1"); lines.reload(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }

  const rows = lines.data || [];
  const transitions: Transition[] = (TRANSITIONS[order.status] || []).map((s) => ({
    to: s,
    label: STATUS_LABEL[s] || s,
    variant: s === "CANCELLED" ? "outline" : "default",
  }));
  const locked = order.status === "DISPATCHED" || order.status === "CANCELLED";

  return (
    <Modal open onClose={onClose} size="xl" title={`Outbound · ${order.outbound_order_id.slice(0, 8)}`} description={order.dispatched_at ? `Dispatched ${dateFmt(order.dispatched_at)}` : undefined}>
      <div className="space-y-5">
        <StepBar steps={["CREATED", "PICKING", "PACKED", "DISPATCHED"]} current={order.status} />
        <StatusActionBar status={order.status} tone={STATUS_TONE[order.status]} transitions={transitions} onTransition={toState} busyKey={busy} />

        {error && <ErrorState message={error} />}

        <LineTable
          rows={rows}
          loading={lines.loading}
          empty="No lines yet."
          rowKey={(l) => l.outbound_line_id}
          columns={[
            { label: "Item", render: (l) => (l.inventory_item_id ? invMap[l.inventory_item_id] || l.inventory_item_id.slice(0, 8) : "—") },
            { label: "Qty", align: "right", render: (l) => <span className="num">{num(l.qty)}</span> },
            { label: "Pick", align: "right", render: (l) => <Toggle on={l.picked} label="Pick" doneLabel="Picked" busy={busy === l.outbound_line_id + "picked"} disabled={locked} onClick={() => flip(l, "picked")} /> },
            { label: "Pack", align: "right", render: (l) => <Toggle on={l.packed} label="Pack" doneLabel="Packed" busy={busy === l.outbound_line_id + "packed"} disabled={!l.picked || locked} onClick={() => flip(l, "packed")} /> },
          ]}
        />

        {canEditLines && (
          <form onSubmit={add} className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-[1fr_120px_auto] sm:items-end">
            <Field label="Add item">
              <Select value={addItem} onChange={(e) => setAddItem(e.target.value)}>
                <option value="">Choose stock…</option>
                {inventory.map((i) => <option key={i.inventory_item_id} value={i.inventory_item_id}>{i.description}{i.sku ? ` (${i.sku})` : ""} · {num(i.qty_on_hand)} on hand</option>)}
              </Select>
            </Field>
            <Field label="Qty"><Input type="number" min="1" className="num text-right" value={addQty} onChange={(e) => setAddQty(e.target.value)} /></Field>
            <Button type="submit" loading={busy === "add"} disabled={!addItem}>Add line</Button>
          </form>
        )}
      </div>
    </Modal>
  );
}

export function OutboundPage() {
  const orders = useResource(() => api.listOutbound(), []);
  const inv = useResource(() => api.listInventory(), []);
  const [view, setView] = React.useState<api.OutboundOrder | null>(null);
  const [creating, setCreating] = React.useState(false);
  const invMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    (inv.data || []).forEach((i) => { m[i.inventory_item_id] = i.description; });
    return m;
  }, [inv.data]);

  async function newOrder() {
    setCreating(true);
    try { const o = await api.createOutbound(); orders.reload(); setView(o); }
    finally { setCreating(false); }
  }

  const cols: Column<api.OutboundOrder>[] = [
    { key: "id", label: "Order", render: (o) => <span className="num font-medium text-foreground">#{o.outbound_order_id.slice(0, 8)}</span> },
    { key: "status", label: "Status", render: (o) => <Pill tone={STATUS_TONE[o.status] || "mute"}>{o.status}</Pill> },
    { key: "created", label: "Created", render: (o) => <span className="num">{dateFmt(o.created_at)}</span> },
    { key: "dispatched", label: "Dispatched", render: (o) => (o.dispatched_at ? <span className="num">{dateFmt(o.dispatched_at)}</span> : <span className="micro">—</span>) },
    { key: "_a", label: "", render: (o) => <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => setView(o)}>Open</Button></div> },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Warehouse" />} title="Outbound" description="Pick, pack and dispatch outbound orders." action={<Button onClick={newOrder} loading={creating}>New order</Button>} />
      <HubTabs />
      <DataList columns={cols} rows={orders.data} error={orders.error} loading={orders.loading} rowKey={(o) => o.outbound_order_id} empty={{ title: "No outbound orders", hint: "Create an order to start picking." }} />
      {view && <OrderDetail order={view} invMap={invMap} inventory={inv.data || []} onClose={() => setView(null)} onChanged={orders.reload} />}
      <ScreenAi path="wms/outbound" />
    </section>
  );
}

export default OutboundPage;
