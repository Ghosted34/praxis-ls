/**
 * Smart Receivables (MOD-52) — ageing buckets, receipts ledger with post-to-GL,
 * dunning reminders, and a receipt detail drawer (FIFO allocations). Composes the
 * locked shared kit; every accent resolves to --primary (settings-driven).
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { DocButton } from "@/components/doc-button";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { money, dateFmt, todayISO, enumLabel } from "@/lib/format";
import type { Client, Entity } from "@/lib/masterdata-api";
import * as api from "@/lib/finance-api";

const shell = pageShell.wide;
const TONES: Record<string, Tone> = { DRAFT: "mute", POSTED_LOCKED: "ok", REVERSED: "bad" };
const tone = (s?: string | null): Tone => TONES[String(s || "").toUpperCase()] || "mute";
const METHODS = ["BANK", "CASH", "MOBILE_MONEY", "CHEQUE"];
const nameMap = (rows: Client[] | null) => {
  const m: Record<string, string> = {};
  (rows || []).forEach((c) => { m[String(c.client_id)] = c.name; });
  return m;
};


/* ── create receipt ── */
const KIND_FOR_METHOD: Record<string, string> = { BANK: "BANK", CHEQUE: "BANK", MOBILE_MONEY: "MOMO", CASH: "CASH" };
function ReceiptForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: clients } = useList<Client>("/clients");
  const { rows: treasury } = useList<api.TreasuryAccount>("/treasury-accounts");
  const [f, setF] = React.useState({ client_id: "", method: "BANK", treasury_account_id: "", amount: "", received_on: todayISO() });
  const [slip, setSlip] = React.useState<File | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const wantsAccount = f.method !== "CASH";
  const accounts = (treasury || []).filter((t) => t.kind === KIND_FOR_METHOD[f.method]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const created = await api.createReceipt({ client_id: f.client_id || undefined, method: f.method, treasury_account_id: f.treasury_account_id || undefined, amount: Number(f.amount), received_on: f.received_on || undefined });
      if (slip && created?.receipt_id) {
        const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(slip); });
        await api.uploadReceiptSlip(created.receipt_id, dataUrl);
      }
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New receipt" description="Log a customer payment; post it to allocate FIFO against open invoices.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client">
            <Select value={f.client_id} onChange={(e) => set("client_id", e.target.value)}>
              <option value="">—</option>
              {(clients || []).map((c) => <option key={c.client_id} value={c.client_id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Method" required>
            <Select value={f.method} onChange={(e) => { set("method", e.target.value); set("treasury_account_id", ""); }}>
              {METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
            </Select>
          </Field>
          {wantsAccount && (
            <Field label="Receiving account" required className="sm:col-span-2" hint="Bank / mobile-money account the funds landed in.">
              <Select value={f.treasury_account_id} onChange={(e) => set("treasury_account_id", e.target.value)}>
                <option value="">Select account…</option>
                {accounts.map((t) => <option key={t.treasury_account_id} value={t.treasury_account_id}>{t.label} · {t.coa_code}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Amount" required><Input type="number" min="0" step="0.01" className="num text-right" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
          <Field label="Received on"><Input type="date" value={f.received_on} onChange={(e) => set("received_on", e.target.value)} /></Field>
          <Field label="Reference / slip" className="sm:col-span-2" hint="Attach the bank slip, transfer confirmation or cheque image (optional).">
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setSlip(e.target.files?.[0] || null)} className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-transparent file:px-3 file:py-1 file:text-sm file:text-foreground" />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!(Number(f.amount) > 0) || (wantsAccount && !f.treasury_account_id) || busy} onCancel={onClose} saveLabel="Create receipt" />
      </form>
    </Modal>
  );
}

/* ── post receipt to GL ── */
function PostForm({ receipt, onClose, onSaved }: { receipt: api.Receipt; onClose: () => void; onSaved: () => void }) {
  const { rows: entities } = useList<Entity>("/entities");
  const [f, setF] = React.useState({ entity_id: "", entry_date: todayISO(), source_doc_ref: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.postReceipt(receipt.receipt_id, { entity_id: f.entity_id || undefined, entry_date: f.entry_date, source_doc_ref: f.source_doc_ref || undefined });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Post receipt" description={`Allocate ${money(receipt.amount)} FIFO to open invoices and book the cash entry.`}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity">
            <Select value={f.entity_id} onChange={(e) => set("entity_id", e.target.value)}>
              <option value="">—</option>
              {(entities || []).map((en) => <option key={en.entity_id} value={en.entity_id}>{en.legal_name || en.code}</option>)}
            </Select>
          </Field>
          <Field label="Entry date" required><Input type="date" value={f.entry_date} onChange={(e) => set("entry_date", e.target.value)} /></Field>
          <Field label="Source doc ref" className="sm:col-span-2"><Input value={f.source_doc_ref} onChange={(e) => set("source_doc_ref", e.target.value)} placeholder="Bank slip / transfer ref" /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={busy} onCancel={onClose} saveLabel="Post & allocate" />
      </form>
    </Modal>
  );
}

/* ── receipt detail drawer ── */
function ReceiptDrawer({ receipt, clientLabel, onClose }: { receipt: api.Receipt; clientLabel: string; onClose: () => void }) {
  const d = useResource(() => api.getReceipt(receipt.receipt_id), [receipt.receipt_id]);
  const rec = d.data;
  // allocation rows carry invoice_id only — resolve to doc numbers (§5)
  const { rows: invoices } = useList<api.InvoiceRow>("/final-invoices");
  const invoiceNo = React.useMemo(() => {
    const m: Record<string, string> = {};
    (invoices || []).forEach((iv) => { if (iv.doc_number) m[iv.invoice_id] = iv.doc_number; });
    return m;
  }, [invoices]);
  return (
    <Modal open onClose={onClose} size="lg" title={`Receipt · ${money(receipt.amount)}`} description={`${clientLabel} · ${enumLabel(receipt.method)}`}>
      {d.loading ? <div className="py-8 text-center micro">Loading…</div> : d.error ? <ErrorState message={d.error} /> : rec ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-card/40 px-3.5 py-2.5"><div className="micro mb-1">Amount</div><div className="num text-lg font-medium text-[rgb(var(--primary))]">{money(rec.amount)}</div></div>
            <div className="rounded-lg border border-border bg-card/40 px-3.5 py-2.5"><div className="micro mb-1">Received</div><div className="num text-lg font-medium">{dateFmt(rec.received_on)}</div></div>
            <div className="rounded-lg border border-border bg-card/40 px-3.5 py-2.5"><div className="micro mb-1">Status</div><div className="mt-1"><Pill tone={tone(rec.status)}>{enumLabel(rec.status)}</Pill></div></div>
          </div>
          <div>
            <div className="micro mb-2">Allocations (FIFO)</div>
            {(rec.allocations || []).length ? (
              <ol className="space-y-1.5">
                {(rec.allocations || []).map((a, i) => (
                  <li key={a.allocation_id || i} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
                    <span className="num text-sm">{a.invoice_id ? invoiceNo[a.invoice_id] || `Invoice ${a.invoice_id.slice(0, 8)}` : "—"}</span>
                    <span className="num text-sm text-[rgb(var(--primary))]">{money(a.amount)}</span>
                  </li>
                ))}
              </ol>
            ) : <span className="micro">Not yet allocated — post the receipt to allocate it against open invoices.</span>}
          </div>
          <div className="flex justify-end border-t pt-3">
            <DocButton docType="PAYMENT_RECEIPT" id={receipt.receipt_id} title={`Receipt ${money(receipt.amount)}`} />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export function ReceivablesPage() {
  const { rows, error, loading, reload } = useList<api.Receipt>("/receivables");
  const { rows: clients } = useList<Client>("/clients");
  const ageing = useResource(() => api.getAgeing(), []);
  const dunning = useResource(() => api.getReminders(), []);
  const [creating, setCreating] = React.useState(false);
  const [posting, setPosting] = React.useState<api.Receipt | null>(null);
  const [view, setView] = React.useState<api.Receipt | null>(null);
  const clientName = nameMap(clients);
  const a = ageing.data;

  const columns: Column<api.Receipt>[] = [
    { key: "received_on", label: "Received", render: (r) => <span className="num">{dateFmt(r.received_on)}</span> },
    { key: "client_id", label: "Client", render: (r) => (r.client_id ? clientName[r.client_id] || "—" : "—") },
    { key: "method", label: "Method", render: (r) => <Pill tone="mute">{enumLabel(r.method)}</Pill> },
    { key: "amount", label: "Amount", className: "num text-right", render: (r) => money(r.amount) },
    { key: "status", label: "Status", render: (r) => <Pill tone={tone(r.status)}>{enumLabel(r.status)}</Pill> },
    {
      key: "_a", label: "", render: (r) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          {r.status === "DRAFT" && <Button size="sm" variant="outline" onClick={() => setPosting(r)}>Post</Button>}
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Finance" to="/finance" />} title="Receivables" description="Ageing, receipts and dunning — the collections side of the money loop." action={<Button onClick={() => setCreating(true)}>New receipt</Button>} />
      <KpiRow>
        <KpiTile label="Current" value={money(a?.current)} />
        <KpiTile label="1–30 days" value={money(a?.d1_30)} />
        <KpiTile label="31–60 days" value={money(a?.d31_60)} />
        <KpiTile label="61–90 days" value={money(a?.d61_90)} />
        <KpiTile label="90+ days" value={money(a?.d90_plus)} />
      </KpiRow>

      {(dunning.data?.reminders || []).length > 0 && (
        <div className="mb-5 rounded-lg border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn))]/10 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Dunning reminders due</span>
            <Pill tone="warn">{dunning.data?.count} overdue</Pill>
          </div>
          <ol className="space-y-1">
            {(dunning.data?.reminders || []).slice(0, 6).map((rm) => (
              <li key={rm.invoice_id} className="flex items-center justify-between text-sm">
                <span>{rm.doc_number || rm.invoice_id.slice(0, 8)}{rm.client_id ? ` · ${clientName[rm.client_id] || ""}` : ""}</span>
                <span className="flex items-center gap-3"><span className="micro">{rm.days_overdue}d overdue</span><span className="num">{money(rm.outstanding)}</span></span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.receipt_id} onRowClick={(r) => setView(r)} empty={{ title: "No receipts yet", hint: "Log a customer payment to start allocating against invoices." }} />

      {creating && <ReceiptForm onClose={() => setCreating(false)} onSaved={() => { reload(); ageing.reload(); dunning.reload(); }} />}
      {posting && <PostForm receipt={posting} onClose={() => setPosting(null)} onSaved={() => { reload(); ageing.reload(); dunning.reload(); }} />}
      {view && <ReceiptDrawer receipt={view} clientLabel={view.client_id ? clientName[view.client_id] || "—" : "—"} onClose={() => setView(null)} />}
    </section>
  );
}
