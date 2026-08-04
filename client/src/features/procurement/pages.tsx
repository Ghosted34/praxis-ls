/**
 * Procurement screens (Wave 3) — purchase requests, purchase orders, goods
 * received (GRN), supplier invoices. Locked shared kit; line editors minimal.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { DocButton } from "@/components/doc-button";
import { DictionaryItemSelect } from "@/components/catalogue-select";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { DepartmentSelect, type DepartmentValue } from "@/components/department-select";
import { money, num, dateFmt, todayISO } from "@/lib/format";
import { reportActionError } from "@/lib/action-error";
import type { Entity, Supplier } from "@/lib/masterdata-api";
import type { Dossier } from "@/lib/operations-api";
import * as api from "@/lib/procurement-api";

const shell = pageShell.wide;
const TONES: Record<string, Tone> = {
  DRAFT: "mute", SUBMITTED: "warn", APPROVED: "ok", REJECTED: "bad", ORDERED: "blue",
  APPROVED_LOCKED: "ok", ISSUED_LOCKED: "blue", RECEIVED: "ok", CLOSED: "mute", CANCELLED: "bad",
  POSTED_LOCKED: "ok", MATCHED: "ok",
};
const tone = (s?: string | null): Tone => TONES[String(s || "").toUpperCase()] || "mute";
const map = <T extends Record<string, unknown>>(rows: T[] | null, id: string, name: string) => {
  const m: Record<string, string> = {}; (rows || []).forEach((r) => { m[String(r[id])] = String(r[name] ?? ""); }); return m;
};

function FormButtons({ busy, disabled, onCancel, saveLabel }: { busy: boolean; disabled?: boolean; onCancel: () => void; saveLabel: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button type="submit" loading={busy} disabled={disabled}>{saveLabel}</Button>
    </div>
  );
}

/* ═══════════════════ Purchase requests ═══════════════════ */

type PrLine = { dictionary_item_id: string; label: string; qty: string; unit_price: string };
const blankPrLine = (): PrLine => ({ dictionary_item_id: "", label: "", qty: "1", unit_price: "" });

function PrForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  // Department is a scope (0490) — carries both the reference and the display
  // snapshot the API stores beside it.
  const [dept, setDept] = React.useState<DepartmentValue>({ scope_id: null, department: null });
  const [justification, setJustification] = React.useState("");
  const [lines, setLines] = React.useState<PrLine[]>([blankPrLine()]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const setLine = (i: number, patch: Partial<PrLine>) => setLines((s) => s.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const cleaned = lines.filter((l) => l.dictionary_item_id).map((l) => ({ dictionary_item_id: l.dictionary_item_id, label: l.label, qty: Number(l.qty) || 1, unit_price: Number(l.unit_price) || 0 }));
      await api.createPurchaseRequest({ scope_id: dept.scope_id || undefined, department: dept.department || undefined, justification: justification || undefined, lines: cleaned.length ? cleaned : undefined });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New purchase request" description="Ask for a purchase to be raised.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Department" hint="From your organigramme — Security › Scopes.">
          <DepartmentSelect value={dept} onChange={setDept} />
        </Field>
        <Field label="Justification"><Input value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Why this is needed" /></Field>
        <div className="space-y-2">
          <div className="micro">Items</div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_110px_auto] items-center gap-2">
              <DictionaryItemSelect value={l.dictionary_item_id} onPick={(id, label) => setLine(i, { dictionary_item_id: id, label })} />
              <Input type="number" min="0" step="any" className="num text-right" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder="Qty" />
              <Input type="number" min="0" step="any" className="num text-right" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} placeholder="Unit (XAF)" />
              <Button type="button" variant="ghost" size="sm" onClick={() => setLines((s) => (s.length > 1 ? s.filter((_, idx) => idx !== i) : s))}>✕</Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((s) => [...s, blankPrLine()])}>Add item</Button>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={busy} onCancel={onClose} saveLabel="Create request" />
      </form>
    </Modal>
  );
}

export function PurchaseRequestsPage() {
  const { rows, error, loading, reload } = useList<api.PurchaseRequest>("/purchase-requests");
  const [open, setOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const list = rows || [];
  // try/finally with no catch swallowed every failure — the button span, then
  // nothing, and the row unchanged. That is exactly how the milestone-advance
  // bug hid a 422 for weeks (session 17). Surface it.
  const [actionError, setActionError] = React.useState<string | null>(null);
  async function submitPr(p: api.PurchaseRequest) {
    setBusyId(p.pr_id);
    setActionError(null);
    try {
      await api.transitionPR(p.pr_id, "SUBMITTED");
      reload();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }
  const columns: Column<api.PurchaseRequest>[] = [
    { key: "ref", label: "Ref", render: (r) => <span className="num font-medium text-foreground">{r.ref || r.pr_id.slice(0, 8)}</span> },
    { key: "department", label: "Department" },
    { key: "justification", label: "Justification" },
    { key: "status", label: "Status", render: (r) => <Pill tone={tone(r.status)}>{r.status}</Pill> },
    {
      key: "_a", label: "", render: (r) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <DocButton docType="PURCHASE_REQUEST" id={r.pr_id} title={r.ref || `Request ${r.pr_id.slice(0, 8)}`} label="View" />
          {(r.status === "DRAFT" || !r.status) && <Button size="sm" variant="outline" loading={busyId === r.pr_id} onClick={() => submitPr(r)}>Submit</Button>}
        </div>
      ),
    },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Procurement" to="/procurement" />} title="Purchase requests" description="Requests to buy, before a PO is raised." action={<Button onClick={() => setOpen(true)}>New request</Button>} />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Requests" value={num(list.length)} />
        <KpiTile label="Approved" value={num(list.filter((p) => p.status === "APPROVED").length)} />
        <KpiTile label="Submitted" value={num(list.filter((p) => p.status === "SUBMITTED").length)} />
      </KpiRow>
      {actionError && <ErrorState message={actionError} />}
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.pr_id} empty={{ title: "No purchase requests", hint: "Raise a request to start procurement." }} />
      {open && <PrForm onClose={() => setOpen(false)} onSaved={reload} />}
      <ScreenAi path="procurement/purchase-requests" />
    </section>
  );
}

/* ═══════════════════ Purchase orders ═══════════════════ */

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
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <DocButton docType="PURCHASE_ORDER" id={r.po_id} title={r.ref || `PO ${r.po_id.slice(0, 8)}`} label="View" />
          {(r.status === "DRAFT" || !r.status) && (
            <Button size="sm" variant="outline" loading={busyId === r.po_id} onClick={() => move(r, "ISSUED_LOCKED")}>Issue</Button>
          )}
          {r.status === "ISSUED_LOCKED" && (
            <Button size="sm" variant="outline" loading={busyId === r.po_id} onClick={() => move(r, "APPROVED_LOCKED")}>Approve</Button>
          )}
        </div>
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

function SupplierInvoiceForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: entities } = useList<Entity>("/entities");
  const { rows: suppliers } = useList<Supplier>("/suppliers");
  const [f, setF] = React.useState({ entity_id: "", supplier_id: "", supplier_ref: "", due_on: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [lines, setLines] = React.useState<api.SupplierInvoiceLine[]>([{ label: "", unit_price: 0, expense_account: "" }]);
  const setLine = (i: number, p: Partial<api.SupplierInvoiceLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const valid = lines.filter((l) => l.expense_account && Number(l.unit_price) >= 0);
    if (valid.length === 0) { setError("Add at least one line with an expense account."); setBusy(false); return; }
    try {
      await api.createSupplierInvoice({
        entity_id: f.entity_id, supplier_id: f.supplier_id || undefined, supplier_ref: f.supplier_ref || undefined, due_on: f.due_on || undefined,
        lines: valid.map((l) => ({ label: l.label, qty: l.qty ? Number(l.qty) : undefined, unit_price: Number(l.unit_price), expense_account: l.expense_account })),
      });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="New supplier invoice" description="Capture a vendor invoice for matching and posting.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <Select value={f.entity_id} onChange={(e) => set("entity_id", e.target.value)}>
              <option value="">—</option>
              {(entities || []).map((en) => <option key={en.entity_id} value={en.entity_id}>{en.legal_name || en.code}</option>)}
            </Select>
          </Field>
          <Field label="Supplier">
            <Select value={f.supplier_id} onChange={(e) => set("supplier_id", e.target.value)}>
              <option value="">—</option>
              {(suppliers || []).map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Supplier ref"><Input value={f.supplier_ref} onChange={(e) => set("supplier_ref", e.target.value)} /></Field>
          <Field label="Due on"><Input type="date" value={f.due_on} onChange={(e) => set("due_on", e.target.value)} /></Field>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="micro">Lines</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLines((l) => [...l, { label: "", unit_price: 0, expense_account: "" }])}>+ Add line</Button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_110px_120px_auto] items-end gap-2">
                <Field label="Label"><Input value={l.label ?? ""} onChange={(e) => setLine(i, { label: e.target.value })} /></Field>
                <Field label="Unit price"><Input type="number" className="num text-right" value={String(l.unit_price ?? "")} onChange={(e) => setLine(i, { unit_price: Number(e.target.value) })} /></Field>
                <Field label="Expense acct"><Input className="num" value={l.expense_account ?? ""} onChange={(e) => setLine(i, { expense_account: e.target.value })} placeholder="6…" /></Field>
                <Button type="button" size="sm" variant="outline" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</Button>
              </div>
            ))}
          </div>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!f.entity_id || busy} onCancel={onClose} saveLabel="Create invoice" />
      </form>
    </Modal>
  );
}

export function SupplierInvoicesPage() {
  const { rows, error, loading, reload } = useList<api.SupplierInvoice>("/supplier-invoices");
  const { rows: suppliers } = useList<Supplier>("/suppliers");
  const [open, setOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const sname = map(suppliers, "supplier_id", "name");
  const list = rows || [];

  async function post(inv: api.SupplierInvoice) {
    setBusyId(inv.supplier_invoice_id);
    try { await api.postSupplierInvoice(inv.supplier_invoice_id, { entry_date: todayISO() }); reload(); } catch (e) { reportActionError(e); } finally { setBusyId(null); }
  }

  const columns: Column<api.SupplierInvoice>[] = [
    { key: "ref", label: "Ref", render: (r) => <span className="num font-medium text-foreground">{r.ref || r.supplier_invoice_id.slice(0, 8)}</span> },
    { key: "supplier_id", label: "Supplier", render: (r) => (r.supplier_id ? sname[r.supplier_id] || "—" : "—") },
    { key: "amount_ttc", label: "Amount", className: "num text-right", render: (r) => money(r.amount_ttc) },
    { key: "due_on", label: "Due", render: (r) => dateFmt(r.due_on) },
    { key: "status", label: "Status", render: (r) => <Pill tone={tone(r.status)}>{r.status}</Pill> },
    {
      key: "_a", label: "", render: (r) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <DocButton docType="SUPPLIER_INVOICE" id={r.supplier_invoice_id} title={r.ref || `Invoice ${r.supplier_invoice_id.slice(0, 8)}`} label="View" />
          {!String(r.status).includes("POSTED") && <Button size="sm" variant="outline" loading={busyId === r.supplier_invoice_id} onClick={() => post(r)}>Post</Button>}
        </div>
      ),
    },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Procurement" to="/procurement" />} title="Supplier invoices" description="Vendor invoices — capture, match, post to the GL." action={<Button onClick={() => setOpen(true)}>New invoice</Button>} />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Invoices" value={num(list.length)} />
        <KpiTile label="Posted" value={num(list.filter((i) => String(i.status).includes("POSTED")).length)} />
        <KpiTile label="Payable" value={money(list.filter((i) => !String(i.status).includes("POSTED")).reduce((s, r) => s + (Number(r.amount_ttc) || 0), 0))} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.supplier_invoice_id} empty={{ title: "No supplier invoices", hint: "Capture a vendor invoice to pay." }} />
      {open && <SupplierInvoiceForm onClose={() => setOpen(false)} onSaved={reload} />}
      <ScreenAi path="procurement/supplier-invoices" />
    </section>
  );
}
