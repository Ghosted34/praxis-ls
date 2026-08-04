/**
 * Procurement — goods-received notes: what actually arrived.
 *
 * Split out of `features/procurement/pages.tsx` in Phase 4 (audit F7).
 */

import * as React from "react";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { useList, errMsg } from "@/lib/use-resource";
import { num, dateFmt, todayISO } from "@/lib/format";
import type { Entity } from "@/lib/masterdata-api";
import * as api from "@/lib/procurement-api";
import { map, shell } from "./shared";

function GrnForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: pos } = useList<api.PurchaseOrder>("/purchase-orders");
  const { rows: entities } = useList<Entity>("/entities");
  const [f, setF] = React.useState({ po_id: "", entity_id: "", supplier_invoice_ref: "", date: todayISO() });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.createGrn({ po_id: f.po_id, entity_id: f.entity_id || undefined, supplier_invoice_ref: f.supplier_invoice_ref || undefined, date: f.date || undefined }); onSaved(); onClose(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Record goods received" description="Confirm receipt against a purchase order.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Purchase order" required>
            <Select value={f.po_id} onChange={(e) => set("po_id", e.target.value)}>
              <option value="">—</option>
              {(pos || []).map((p) => <option key={p.po_id} value={p.po_id}>{p.ref || p.po_id.slice(0, 8)}</option>)}
            </Select>
          </Field>
          <Field label="Entity">
            <Select value={f.entity_id} onChange={(e) => set("entity_id", e.target.value)}>
              <option value="">—</option>
              {(entities || []).map((en) => <option key={en.entity_id} value={en.entity_id}>{en.legal_name || en.code}</option>)}
            </Select>
          </Field>
          <Field label="Supplier invoice ref"><Input value={f.supplier_invoice_ref} onChange={(e) => set("supplier_invoice_ref", e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!f.po_id || busy} onCancel={onClose} saveLabel="Record GRN" />
      </form>
    </Modal>
  );
}

export function GoodsReceivedPage() {
  const { rows, error, loading, reload } = useList<api.Grn>("/goods-received");
  const { rows: pos } = useList<api.PurchaseOrder>("/purchase-orders");
  const [open, setOpen] = React.useState(false);
  const poref = map(pos, "po_id", "ref");
  const columns: Column<api.Grn>[] = [
    { key: "ref", label: "Ref", render: (r) => <span className="num font-medium text-foreground">{r.ref || r.grn_id.slice(0, 8)}</span> },
    { key: "po_id", label: "Purchase order", render: (r) => (r.po_id ? poref[r.po_id] || r.po_id.slice(0, 8) : "—") },
    { key: "supplier_invoice_ref", label: "Supplier inv. ref" },
    { key: "created_at", label: "Received", render: (r) => dateFmt(r.created_at) },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Procurement" to="/procurement" />} title="Goods received" description="Receipt notes (GRN) against purchase orders." action={<Button onClick={() => setOpen(true)}>New GRN</Button>} />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Receipts" value={num((rows || []).length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.grn_id} empty={{ title: "No goods received", hint: "Record receipt when a PO is delivered." }} />
      {open && <GrnForm onClose={() => setOpen(false)} onSaved={reload} />}
      <ScreenAi path="procurement/goods-received" />
    </section>
  );
}

/* ═══════════════════ Supplier invoices ═══════════════════ */
