/**
 * Procurement — purchase orders: the committed order to a supplier.
 *
 * Split out of `features/procurement/pages.tsx` in Phase 4 (audit F7).
 */

import * as React from "react";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { DocButton } from "@/components/doc-button";
import { DictionaryItemSelect } from "@/components/catalogue-select";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { RowActions } from "@/components/ui/row-actions";
import { money, num, todayISO } from "@/lib/format";
import type { Entity, Supplier } from "@/lib/masterdata-api";
import type { Dossier } from "@/lib/operations-api";
import * as api from "@/lib/procurement-api";
import { map, shell, tone } from "./shared";

function PoForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: suppliers } = useList<Supplier>("/suppliers");
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [f, setF] = React.useState({ supplier_id: "", dossier_id: "", expense_category: "OPERATIONS" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [items, setItems] = React.useState<api.PoItem[]>([{ label: "", qty: 1, unit_price: 0 }]);
  const setItem = (i: number, p: Partial<api.PoItem>) => setItems((its) => its.map((it, j) => (j === i ? { ...it, ...p } : it)));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.createPurchaseOrder({
        supplier_id: f.supplier_id || undefined, dossier_id: f.dossier_id || undefined,
        expense_category: f.expense_category as api.PurchaseOrderInput["expense_category"],
        items: items.filter((it) => it.dictionary_item_id).map((it) => ({ dictionary_item_id: it.dictionary_item_id, label: it.label, qty: Number(it.qty) || 1, unit_price: Number(it.unit_price) || 0 })),
      });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="New purchase order" description="Order goods/services from a supplier.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Supplier">
            <Select value={f.supplier_id} onChange={(e) => set("supplier_id", e.target.value)}>
              <option value="">—</option>
              {(suppliers || []).map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Dossier">
            <Select value={f.dossier_id} onChange={(e) => set("dossier_id", e.target.value)}>
              <option value="">—</option>
              {(dossiers || []).map((d) => <option key={d.dossier_id} value={d.dossier_id}>{d.ref}</option>)}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={f.expense_category} onChange={(e) => set("expense_category", e.target.value)}>
              <option value="OPERATIONS">Operations</option>
              <option value="OVERHEAD">Overhead</option>
            </Select>
          </Field>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="micro">Items</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setItems((i) => [...i, { label: "", qty: 1, unit_price: 0 }])}>+ Add item</Button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_120px_auto] items-end gap-2">
                <Field label="Item"><DictionaryItemSelect value={it.dictionary_item_id} onPick={(id, label) => setItem(i, { dictionary_item_id: id, label })} /></Field>
                <Field label="Qty"><Input type="number" className="num text-right" value={String(it.qty ?? "")} onChange={(e) => setItem(i, { qty: Number(e.target.value) })} /></Field>
                <Field label="Unit price"><Input type="number" className="num text-right" value={String(it.unit_price ?? "")} onChange={(e) => setItem(i, { unit_price: Number(e.target.value) })} /></Field>
                <Button type="button" size="sm" variant="outline" disabled={items.length === 1} onClick={() => setItems((its) => its.filter((_, j) => j !== i))}>✕</Button>
              </div>
            ))}
          </div>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={busy} onCancel={onClose} saveLabel="Create PO" />
      </form>
    </Modal>
  );
}

export function PurchaseOrdersPage() {
  const { rows, error, loading, reload } = useList<api.PurchaseOrder>("/purchase-orders");
  const { rows: suppliers } = useList<Supplier>("/suppliers");
  const { rows: entities } = useList<Entity>("/entities");
  const [open, setOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const sname = map(suppliers, "supplier_id", "name");
  const list = rows || [];

  /**
   * The screen showed one button, "Approve", on DRAFT rows — and it could never
   * work: DRAFT → APPROVED_LOCKED is not a legal transition
   * (purchase_order.rules.js), so it always 422'd, silently, because the handler
   * had no catch.
   *
   * A PO is ISSUED first, and issuing is what opens the approval chain
   * (`po.issued`). With no Issue button the chain could never open from the UI —
   * the same gap costing had. So: Issue on DRAFT, Approve on ISSUED_LOCKED.
   *
   * Issuing allocates the document number, which needs an entity — the API
   * raises ENTITY_REQUIRED without one.
   */
  async function move(p: api.PurchaseOrder, to: "ISSUED_LOCKED" | "APPROVED_LOCKED") {
    setBusyId(p.po_id);
    setActionError(null);
    try {
      const extra = to === "ISSUED_LOCKED"
        ? { entity_id: (entities || [])[0]?.entity_id, date: todayISO() }
        : {};
      await api.transitionPO(p.po_id, to, extra);
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }
  const columns: Column<api.PurchaseOrder>[] = [
    { key: "ref", label: "Ref", render: (r) => <span className="num font-medium text-foreground">{r.ref || r.po_id.slice(0, 8)}</span> },
    { key: "supplier_id", label: "Supplier", render: (r) => (r.supplier_id ? sname[r.supplier_id] || "—" : "—") },
    { key: "expense_category", label: "Category", render: (r) => (r.expense_category ? <Pill tone="mute">{r.expense_category}</Pill> : "—") },
    { key: "total_ttc", label: "Total", className: "num text-right", render: (r) => money(r.total_ttc) },
    { key: "status", label: "Status", render: (r) => <Pill tone={tone(r.status)}>{r.status}</Pill> },
    {
      key: "_a", label: "", render: (r) => (
        <RowActions>
          <DocButton docType="PURCHASE_ORDER" id={r.po_id} title={r.ref || `PO ${r.po_id.slice(0, 8)}`} label="View" />
          {(r.status === "DRAFT" || !r.status) && (
            <Button size="sm" variant="outline" loading={busyId === r.po_id} onClick={() => move(r, "ISSUED_LOCKED")}>Issue</Button>
          )}
          {r.status === "ISSUED_LOCKED" && (
            <Button size="sm" variant="outline" loading={busyId === r.po_id} onClick={() => move(r, "APPROVED_LOCKED")}>Approve</Button>
          )}
        </RowActions>
      ),
    },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Procurement" to="/procurement" />} title="Purchase orders" description="Orders raised to suppliers." action={<Button onClick={() => setOpen(true)}>New PO</Button>} />
      <HubTabs />
      <KpiRow>
        <KpiTile label="POs" value={num(list.length)} />
        <KpiTile label="Approved" value={num(list.filter((p) => String(p.status).includes("APPROVED")).length)} />
        <KpiTile label="Spend" value={money(list.reduce((s, r) => s + (Number(r.total_ttc) || 0), 0))} />
      </KpiRow>
      {actionError && <ErrorState message={actionError} />}
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.po_id} empty={{ title: "No purchase orders", hint: "Raise a PO to a supplier." }} />
      {open && <PoForm onClose={() => setOpen(false)} onSaved={reload} />}
      <ScreenAi path="procurement/purchase-orders" />
    </section>
  );
}

/* ═══════════════════ Goods received (GRN) ═══════════════════ */
