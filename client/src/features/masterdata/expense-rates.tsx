/**
 * Master data — standing expense rates (per-diem and friends).
 *
 * Split out of `features/masterdata/pages.tsx` in Phase 4 (audit F7).
 */

import * as React from "react";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { RowActions } from "@/components/ui/row-actions";
import { useList, errMsg } from "@/lib/use-resource";
import { money, dateFmt } from "@/lib/format";
import * as api from "@/lib/masterdata-api";
import { reportActionError } from "@/lib/action-error";
import { shell } from "./shared";

function ExpenseRateForm({ row, onClose, onSaved }: { row: api.ExpenseRate | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const { rows: dict } = useList<api.DictItem>("/financial-dictionary");
  const [dictId, setDictId] = React.useState(row?.dictionary_item_id ?? "");
  const [line, setLine] = React.useState(row?.shipping_line ?? "");
  const [variant, setVariant] = React.useState(row?.variant ?? "");
  const [rate, setRate] = React.useState(row?.rate != null ? String(row.rate) : "");
  const [currency, setCurrency] = React.useState(row?.currency ?? "XAF");
  const [from, setFrom] = React.useState(row?.effective_from ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: api.ExpenseRateInput = { dictionary_item_id: dictId, shipping_line: line, variant: variant || undefined, rate: Number(rate), currency: currency || undefined, effective_from: from || undefined };
    try {
      if (isNew) await api.createExpenseRate(body);
      else await api.updateExpenseRate(row!.expense_rate_id, body);
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "New expense rate" : "Edit expense rate"} description="Seeded-but-editable rate per shipping line — feeds costing.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dictionary item" required className="sm:col-span-2">
            <Select value={dictId} onChange={(e) => setDictId(e.target.value)}>
              <option value="">—</option>
              {(dict || []).map((d) => <option key={d.dictionary_item_id} value={d.dictionary_item_id}>{d.code} — {d.label_fr || d.label_en}</option>)}
            </Select>
          </Field>
          <Field label="Shipping line" required><Input value={line} onChange={(e) => setLine(e.target.value)} placeholder="MAERSK" /></Field>
          <Field label="Variant"><Input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="20ft / 40ft" /></Field>
          <Field label="Rate" required><Input type="number" min="0" step="0.01" className="num text-right" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
          <Field label="Currency"><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></Field>
          <Field label="Effective from"><Input type="date" value={from ?? ""} onChange={(e) => setFrom(e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!dictId || !line || rate === "" || busy} onCancel={onClose} saveLabel={isNew ? "Create rate" : "Save changes"} />
      </form>
    </Modal>
  );
}

export function ExpenseRatesPage() {
  const { rows, error, loading, reload } = useList<api.ExpenseRate>("/expense-rates");
  const { rows: dict } = useList<api.DictItem>("/financial-dictionary");
  const [editing, setEditing] = React.useState<api.ExpenseRate | "new" | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  // `id` is typed non-null, but an unguarded `.slice()` on it means one null FK
  // takes down the whole screen instead of rendering a dash in one cell. Not a
  // defect anyone has hit — a cheap bound on how badly one bad row can fail.
  const dictLabel = (id: string | null | undefined) => {
    const d = (dict || []).find((x) => x.dictionary_item_id === id);
    if (d) return d.code;
    return id ? id.slice(0, 8) : "—";
  };

  async function remove(r: api.ExpenseRate) {
    if (!window.confirm("Delete this expense rate?")) return;
    setBusyId(r.expense_rate_id);
    try { await api.deleteExpenseRate(r.expense_rate_id); reload(); } catch (e) { reportActionError(e); } finally { setBusyId(null); }
  }

  const columns: Column<api.ExpenseRate>[] = [
    { key: "dictionary_item_id", label: "Item", render: (r) => <span className="num">{dictLabel(r.dictionary_item_id)}</span> },
    { key: "shipping_line", label: "Shipping line", render: (r) => <span className="font-medium text-foreground">{r.shipping_line}</span> },
    { key: "variant", label: "Variant" },
    { key: "rate", label: "Rate", className: "num text-right", render: (r) => money(r.rate, r.currency || "XAF") },
    { key: "effective_from", label: "From", render: (r) => dateFmt(r.effective_from) },
    {
      key: "_a", label: "", render: (r) => (
        <RowActions>
          <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
          <Button size="sm" variant="outline" loading={busyId === r.expense_rate_id} onClick={() => remove(r)}>Delete</Button>
        </RowActions>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Master data" to="/master" />} title="Expense rates" description="Per-shipping-line rates that feed costing." action={<Button onClick={() => setEditing("new")}>New rate</Button>} />
      <HubTabs />
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.expense_rate_id} empty={{ title: "No expense rates", hint: "Add a rate per shipping line and dictionary item." }} />
      {editing !== null && <ExpenseRateForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      <ScreenAi path="master/expense-rates" />
    </section>
  );
}

/* ══════════════════════ Financial dictionary ════════════════════ */
