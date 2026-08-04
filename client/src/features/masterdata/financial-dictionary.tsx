/**
 * Master data — the financial dictionary: the priced line items every
 * quotation, invoice and costing picks from.
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
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, ActivePill } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { money, num } from "@/lib/format";
import * as api from "@/lib/masterdata-api";
import { shell } from "./shared";

const CATEGORIES = ["debours", "service", "overhead", "asset", "other"] as const;
const CONTEXTS = ["sale", "purchase", "disbursement"] as const;
const catTone = (c: string): React.ComponentProps<typeof Pill>["tone"] => (c === "debours" ? "warn" : c === "service" ? "blue" : c === "asset" ? "ok" : "mute");

function DictForm({ row, onClose, onSaved }: { row: api.DictItem | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const [code, setCode] = React.useState(row?.code ?? "");
  const [labelFr, setLabelFr] = React.useState(row?.label_fr ?? "");
  const [labelEn, setLabelEn] = React.useState(row?.label_en ?? "");
  const [category, setCategory] = React.useState<string>(row?.category ?? "service");
  const [price, setPrice] = React.useState(row?.default_price != null ? String(row.default_price) : "");
  const [currency, setCurrency] = React.useState(row?.currency ?? "XAF");
  const [rules, setRules] = React.useState<api.PostingRule[]>([{ applies_context: "sale", debit_account: "", credit_account: "" }]);
  const [loadingRules, setLoadingRules] = React.useState(!isNew);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // On edit, load the item's real posting rules (GET /:id returns them) so they
  // can be edited in place rather than clobbered.
  React.useEffect(() => {
    if (isNew) return;
    let live = true;
    api.getDict(row!.dictionary_item_id)
      .then((full) => {
        if (!live) return;
        const rs = (full.posting_rules || []).map((r) => ({
          applies_context: r.applies_context,
          debit_account: r.debit_account ?? "",
          credit_account: r.credit_account ?? "",
          tax_code_id: r.tax_code_id,
          is_debours: r.is_debours,
        }));
        setRules(rs.length ? rs : [{ applies_context: "sale", debit_account: "", credit_account: "" }]);
      })
      .catch((e) => { if (live) setError(errMsg(e)); })
      .finally(() => { if (live) setLoadingRules(false); });
    return () => { live = false; };
  }, [isNew, row]);

  const setRule = (i: number, patch: Partial<api.PostingRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRule = () => setRules((rs) => [...rs, { applies_context: "sale", debit_account: "", credit_account: "" }]);
  const delRule = (i: number) => setRules((rs) => rs.filter((_, j) => j !== i));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const base = {
      code,
      label_fr: labelFr,
      label_en: labelEn || undefined,
      category: category as api.DictInput["category"],
      default_price: price === "" ? undefined : Number(price),
      currency: currency || undefined,
    };
    const posting_rules = rules.map((r) => ({ ...r, debit_account: r.debit_account || undefined, credit_account: r.credit_account || undefined }));
    try {
      if (isNew) await api.createDict({ ...base, posting_rules });
      else await api.updateDict(row!.dictionary_item_id, { ...base, posting_rules });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={isNew ? "New dictionary item" : "Edit dictionary item"} description="A billable/cost line with its OHADA posting rules.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" required><Input className="num" value={code} onChange={(e) => setCode(e.target.value)} placeholder="FREIGHT" /></Field>
          <Field label="Category" required>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Label (FR)" required><Input value={labelFr} onChange={(e) => setLabelFr(e.target.value)} /></Field>
          <Field label="Label (EN)"><Input value={labelEn ?? ""} onChange={(e) => setLabelEn(e.target.value)} /></Field>
          <Field label="Default price"><Input type="number" min="0" step="0.01" className="num text-right" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label="Currency"><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="micro">Posting rules</span>
            <Button type="button" size="sm" variant="ghost" onClick={addRule} disabled={loadingRules}>+ Add rule</Button>
          </div>
          {loadingRules ? (
            <p className="text-xs text-muted-foreground">Loading posting rules…</p>
          ) : (
            <div className="space-y-2">
              {rules.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                  <Field label="Context"><Select value={r.applies_context} onChange={(e) => setRule(i, { applies_context: e.target.value as api.PostingRule["applies_context"] })}>{CONTEXTS.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
                  <Field label="Debit"><Input className="num" value={r.debit_account ?? ""} onChange={(e) => setRule(i, { debit_account: e.target.value })} placeholder="6…" /></Field>
                  <Field label="Credit"><Input className="num" value={r.credit_account ?? ""} onChange={(e) => setRule(i, { credit_account: e.target.value })} placeholder="7…" /></Field>
                  <Button type="button" size="sm" variant="outline" disabled={rules.length === 1} onClick={() => delRule(i)}>✕</Button>
                </div>
              ))}
            </div>
          )}
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!code || !labelFr || rules.length === 0 || loadingRules || busy} onCancel={onClose} saveLabel={isNew ? "Create item" : "Save changes"} />
      </form>
    </Modal>
  );
}

export function FinancialDictionaryPage() {
  const { rows, error, loading, reload } = useList<api.DictItem>("/financial-dictionary");
  const [editing, setEditing] = React.useState<api.DictItem | "new" | null>(null);
  const items = rows || [];
  const columns: Column<api.DictItem>[] = [
    { key: "code", label: "Code", render: (r) => <span className="num font-medium text-foreground">{r.code}</span> },
    { key: "label_fr", label: "Label", render: (r) => r.label_fr || r.label_en || "—" },
    { key: "category", label: "Category", render: (r) => <Pill tone={catTone(r.category)}>{r.category}</Pill> },
    { key: "default_price", label: "Default price", className: "num text-right", render: (r) => money(r.default_price, r.currency || "XAF") },
    { key: "is_active", label: "Status", render: (r) => <ActivePill active={r.is_active} /> },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Master data" to="/master" />} title="Financial dictionary" description="Billable & cost lines with their OHADA posting rules." action={<Button onClick={() => setEditing("new")}>New item</Button>} />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Items" value={num(items.length)} />
        <KpiTile label="Débours" value={num(items.filter((i) => i.category === "debours").length)} />
        <KpiTile label="Services" value={num(items.filter((i) => i.category === "service").length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.dictionary_item_id} onRowClick={(r) => setEditing(r)} empty={{ title: "Dictionary is empty", hint: "Add billable/cost items so quotes and costing can reference them." }} />
      {editing !== null && <DictForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      <ScreenAi path="master/financial-dictionary" />
    </section>
  );
}
