/**
 * Chart of accounts (MOD-58) — SYSCOHADA/OHADA statutory chart. Class filter chips,
 * search, and sub-account create/edit. Read-heavy master screen on the locked kit;
 * accents resolve to --primary (settings-driven).
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
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { num } from "@/lib/format";
import * as api from "@/lib/finance-api";

const shell = pageShell.wide;
const CLASS_NAMES: Record<number, string> = {
  1: "Equity & liabilities", 2: "Fixed assets", 3: "Inventory", 4: "Third parties", 5: "Treasury",
  6: "Expenses", 7: "Revenue", 8: "Special", 9: "Analytic",
};


function AccountForm({ row, onClose, onSaved }: { row: api.Account | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const [f, setF] = React.useState({
    code: row?.code ?? "", parent_code: row?.parent_code ?? "", label_fr: row?.label_fr ?? "", label_en: row?.label_en ?? "",
    klass: row?.class != null ? String(row.class) : "6", normal_balance: row?.normal_balance ?? "D",
    is_postable: row?.is_postable ?? true, requires_analytic: row?.requires_analytic ?? false,
  });
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      if (isNew) {
        await api.createAccount({
          code: f.code, parent_code: f.parent_code || undefined, label_fr: f.label_fr, label_en: f.label_en || undefined,
          class: Number(f.klass), normal_balance: f.normal_balance as "D" | "C", is_postable: f.is_postable, requires_analytic: f.requires_analytic,
        });
      } else {
        await api.updateAccount(row!.code, {
          label_fr: f.label_fr, label_en: f.label_en || undefined, normal_balance: f.normal_balance as "D" | "C",
          is_postable: f.is_postable, requires_analytic: f.requires_analytic, parent_code: f.parent_code || undefined,
        });
      }
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={isNew ? "New account" : `Edit ${row!.code}`} description="Only leaf/detail accounts are postable; 4731 / 706 / 707 require a dossier.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" required><Input value={f.code} onChange={(e) => set("code", e.target.value)} disabled={!isNew} className="num" placeholder="706100" /></Field>
          <Field label="Parent code"><Input value={f.parent_code} onChange={(e) => set("parent_code", e.target.value)} className="num" placeholder="706" /></Field>
          <Field label="Label (FR)" required className="sm:col-span-2"><Input value={f.label_fr} onChange={(e) => set("label_fr", e.target.value)} /></Field>
          <Field label="Label (EN)" className="sm:col-span-2"><Input value={f.label_en} onChange={(e) => set("label_en", e.target.value)} /></Field>
          <Field label="Class" required>
            <Select value={f.klass} onChange={(e) => set("klass", e.target.value)} disabled={!isNew}>
              {Object.entries(CLASS_NAMES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
            </Select>
          </Field>
          <Field label="Normal balance" required>
            <Select value={f.normal_balance} onChange={(e) => set("normal_balance", e.target.value)}>
              <option value="D">Debit</option>
              <option value="C">Credit</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_postable} onChange={(e) => set("is_postable", e.target.checked)} /> Postable (leaf account)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requires_analytic} onChange={(e) => set("requires_analytic", e.target.checked)} /> Requires analytic (dossier)</label>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={busy || !(f.code && f.label_fr)} onCancel={onClose} saveLabel={isNew ? "Create account" : "Save changes"} />
      </form>
    </Modal>
  );
}

export function ChartOfAccountsPage() {
  const { rows, error, loading, reload } = useList<api.Account>("/chart-of-accounts");
  const [editing, setEditing] = React.useState<api.Account | "new" | null>(null);
  const [q, setQ] = React.useState("");
  const [klass, setKlass] = React.useState<number | "ALL">("ALL");
  const accounts = React.useMemo(() => rows || [], [rows]);

  const classCounts = React.useMemo(() => {
    const m: Record<string, number> = {};
    accounts.forEach((a) => { m[a.class] = (m[a.class] || 0) + 1; });
    return m;
  }, [accounts]);

  const filtered = accounts.filter((a) => {
    if (klass !== "ALL" && a.class !== klass) return false;
    if (!q.trim()) return true;
    const hay = `${a.code} ${a.label_fr} ${a.label_en || ""}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  const columns: Column<api.Account>[] = [
    { key: "code", label: "Code", render: (a) => <span className="num font-medium text-foreground">{a.code}</span> },
    { key: "label", label: "Label", render: (a) => a.label_fr },
    { key: "class", label: "Class", render: (a) => <Pill tone="mute">{a.class} · {CLASS_NAMES[a.class] || ""}</Pill> },
    { key: "normal_balance", label: "Bal", render: (a) => <span className="num">{a.normal_balance}</span> },
    { key: "is_postable", label: "Postable", render: (a) => (a.is_postable ? <Pill tone="ok">Postable</Pill> : <span className="text-muted-foreground">—</span>) },
    { key: "requires_analytic", label: "Analytic", render: (a) => (a.requires_analytic ? <Pill tone="warn">Dossier</Pill> : <span className="text-muted-foreground">—</span>) },
    {
      key: "_a", label: "", render: (a) => (
        // A click SHIELD, not a control: it stops a row action reaching the
        // row's own onRowClick. The real controls inside are buttons and are
        // keyboard-reachable, so role="presentation" is accurate — F13 targets
        // handlers that ARE the interaction, which this is not.
        <div className="flex justify-end" role="presentation" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Edit</Button>
        </div>
      ),
    },
  ];

  const chips: (number | "ALL")[] = ["ALL", ...Object.keys(CLASS_NAMES).map(Number).filter((c) => (classCounts[c] || 0) > 0)];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Finance" to="/finance" />} title="Chart of accounts" description="SYSCOHADA/OHADA statutory chart — postable leaves and analytic accounts." action={<Button onClick={() => setEditing("new")}>New account</Button>} />
      <KpiRow>
        <KpiTile label="Accounts" value={num(accounts.length)} />
        <KpiTile label="Postable" value={num(accounts.filter((a) => a.is_postable).length)} />
        <KpiTile label="Analytic" value={num(accounts.filter((a) => a.requires_analytic).length)} />
      </KpiRow>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="chips">
          {chips.map((c) => {
            const on = klass === c;
            return (
              <button key={String(c)} onClick={() => setKlass(c)} className={`chip ${on ? "on" : ""}`}>
                {c === "ALL" ? "All" : `Class ${c}`} <span className="ct num">{c === "ALL" ? accounts.length : classCounts[c] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or label…" className="w-full max-w-xs" />
      </div>
      <DataList columns={columns} rows={filtered} error={error} loading={loading} rowKey={(a) => a.code} onRowClick={(a) => setEditing(a)} empty={{ title: "No accounts", hint: "The statutory chart seeds on tenant bootstrap; add sub-accounts here." }} />
      {editing !== null && <AccountForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </section>
  );
}
