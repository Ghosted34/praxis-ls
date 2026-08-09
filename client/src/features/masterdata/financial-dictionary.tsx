/**
 * Master data — the Financial Dictionary 360.
 *
 * The heart of operations: every quote, invoice, costing sheet, cash request and
 * journal line speaks in dictionary items, and each item carries its OHADA fate.
 * Master → detail 360 (same shape as client-360 / service-type-360): a filtered
 * list rail on the left, a full dossier on the right — identity, the OHADA
 * posting map, the Basic/Advanced/Full service tiers, compliance controls, and
 * where the item is used across the system.
 *
 * PR2 adds the money half: a Spend tab (estimated / committed / actual over a
 * period, with drill-ins to the underlying documents), a Cost & evolution tab
 * (the effective-dated rate history and its trend), and a bulk Excel import.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Callout } from "@/components/ui/callout";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { SplitPane } from "@/components/ui/split-pane";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, num } from "@/lib/format";
import * as api from "@/lib/masterdata-api";
import { DictForm } from "./financial-dictionary-form";
import { FinancialDictionarySettings } from "./financial-dictionary-settings";
import { SpendTab, CostEvolutionTab } from "./financial-dictionary-spend";
import { DictImportModal } from "./financial-dictionary-import";

const shell = pageShell.wide;

const DIR_TONE: Record<string, React.ComponentProps<typeof Pill>["tone"]> = { REVENUE: "ok", EXPENSE: "warn", DEBOURS: "blue", ASSET: "orange" };
const dirLabel = (d?: string) => (d ? d[0] + d.slice(1).toLowerCase() : "—");
const DIR_FILTER = [{ value: "", label: "All" }, { value: "REVENUE", label: "Revenue" }, { value: "EXPENSE", label: "Expense" }, { value: "DEBOURS", label: "Débours" }, { value: "ASSET", label: "Asset" }];

export function FinancialDictionaryPage() {
  const [q, setQ] = React.useState("");
  const [dir, setDir] = React.useState<string>("");
  const list = useResource(() => api.listDict({ q: q || undefined, direction: (dir || undefined) as api.Direction | undefined }), [q, dir]);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<api.DictFull | "new" | null>(null);
  const [settings, setSettings] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  const rows = React.useMemo(() => list.data || [], [list.data]);
  React.useEffect(() => { if (!selId && rows.length) setSelId(rows[0].dictionary_item_id); }, [rows, selId]);

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Master data" to="/master" />}
        title="Financial dictionary"
        description="Priced lines with their OHADA posting rules — the single source every quote, invoice and costing reads."
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSettings(true)}>⚙ Settings</Button>
            <Button variant="outline" size="sm" onClick={() => setImporting(true)}>Import</Button>
            <Button onClick={() => setEditing("new")}>New item</Button>
          </div>
        }
      />
      <HubTabs />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input placeholder="Search code or name…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Segmented label="Direction filter" value={dir} onChange={setDir} options={DIR_FILTER} />
      </div>

      {list.error ? <ErrorState message={list.error} /> : (
        <SplitPane storageKey="master.dictionary" label="Dictionary list width" defaultSize={300} min={240} max={520}>
          <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
            {list.loading ? <LoadingRow label="Loading dictionary…" /> : rows.length === 0 ? <div className="px-3 py-4 micro">No items.</div> : rows.map((r) => (
              <button key={r.dictionary_item_id} onClick={() => setSelId(r.dictionary_item_id)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${r.dictionary_item_id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}>
                <span className="min-w-0">
                  <span className="num text-xs font-semibold text-foreground">{r.code}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.label_en || r.label_fr}</span>
                </span>
                <Pill tone={DIR_TONE[r.direction] || "mute"}>{dirLabel(r.direction)}</Pill>
              </button>
            ))}
          </div>
          {selId ? <DictDossier id={selId} onEdit={(d) => setEditing(d)} onChanged={list.reload} /> : <EmptyState title="No item selected" hint="Choose a line from the list." />}
        </SplitPane>
      )}

      {editing !== null && <DictForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={list.reload} />}
      {/* onImported fires on COMMIT, not on close, so imported rows appear in
          the rail immediately — the modal stays open showing what was rejected. */}
      <DictImportModal open={importing} onClose={() => setImporting(false)} onImported={list.reload} />
      <FinancialDictionarySettings open={settings} onClose={() => setSettings(false)} />
      <ScreenAi path="master/financial-dictionary" />
    </section>
  );
}

const TABS = ["Overview", "Spend", "Cost & evolution", "OHADA posting", "Service tiers", "Compliance"] as const;
type Tab = (typeof TABS)[number];

function DictDossier({ id, onEdit, onChanged }: { id: string; onEdit: (d: api.DictFull) => void; onChanged: () => void }) {
  const dossier = useResource(() => api.dictDossier(id), [id]);
  const [tab, setTab] = React.useState<Tab>("Overview");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  if (dossier.loading) return <LoadingRow label="Loading 360…" />;
  if (dossier.error) return <ErrorState message={dossier.error} />;
  if (!dossier.data) return <EmptyState title="Not found" hint="This item may have been removed." />;

  const d = dossier.data;
  const it = d.item;
  const u = d.usage;

  async function toggleActive() {
    setBusy(true); setErr(null);
    try { await api.updateDict(id, { is_active: !it.is_active }); dossier.reload(); onChanged(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-sm font-bold text-foreground">{it.code}</span>
              {/* h2 (not h3): PageHeader is the page's only h1, so the dossier
                  heading is the next level down (heading-order, WCAG 1.3.1). */}
              <h2 className="truncate text-lg font-semibold text-foreground">{it.label_en || it.label_fr}</h2>
              <Pill tone={DIR_TONE[it.direction] || "mute"}>{dirLabel(it.direction)}</Pill>
              <Pill tone={it.is_active ? "ok" : "mute"}>{it.is_active ? "Active" : "Inactive"}</Pill>
              {it.is_debours && <Pill tone="blue">Débours</Pill>}
            </div>
            <p className="mt-1 micro">{[it.label_fr, it.category, it.subcategory, it.applicability_mode?.replace(/_/g, " ").toLowerCase()].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => onEdit(d.item)}>Edit</Button>
            <Button size="sm" variant="outline" loading={busy} onClick={toggleActive}>{it.is_active ? "Deactivate" : "Activate"}</Button>
          </div>
        </div>
        {err && <div className="mt-3"><ErrorState message={err} /></div>}
        {d.compliance.needs_attention && (
          <div className="mt-3"><Callout tone="warn" title="Compliance gap">This line always requires a receipt but names no valid proof source. Set one so cash requests can be checked.</Callout></div>
        )}
      </div>

      {/* Usage KPI strip — the money rollups (PR2) hang off these counts. */}
      <KpiRow>
        <KpiTile label="Costings" value={num(u.costing_lines)} />
        <KpiTile label="Cash requests" value={num(u.cash_request_lines)} />
        <KpiTile label="Invoices" value={num(u.invoice_lines)} />
        <KpiTile label="Purchase orders" value={num(u.purchase_order_items)} />
        <KpiTile label="Rates" value={num(u.expense_rates)} />
      </KpiRow>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}{t === "Service tiers" && d.service_tiers.length ? <span className="ml-1.5 micro">{d.service_tiers.length}</span> : null}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Identity">
            <KV k="Code" v={<span className="num">{it.code}</span>} />
            <KV k="Name (FR)" v={it.label_fr || "—"} />
            <KV k="Name (EN)" v={it.label_en || "—"} />
            <KV k="Direction" v={dirLabel(it.direction)} />
            <KV k="Category" v={it.category + (it.subcategory ? ` · ${it.subcategory}` : "")} />
            <KV k="Applicability" v={it.applicability_mode?.replace(/_/g, " ").toLowerCase()} />
          </Panel>
          <Panel title="Commercials">
            <KV k="Default price" v={it.default_price != null ? money(it.default_price, it.currency || "XAF") : "—"} />
            <KV k="Currency" v={it.currency || "XAF"} />
            <KV k="Unit" v={it.unit_of_measure || "—"} />
            <KV k="Billable" v={it.is_billable ? "Yes" : "No"} />
            <KV k="Provider kind" v={it.provider_kind || "—"} />
            <KV k="Description" v={it.description || "—"} />
          </Panel>
        </div>
      )}

      {/* Mounted only when selected: each owns its own fetch, and the spend
          query is a four-table aggregate nobody should pay for on a tab they
          are not looking at. */}
      {tab === "Spend" && <SpendTab id={id} />}
      {tab === "Cost & evolution" && <CostEvolutionTab id={id} />}

      {tab === "OHADA posting" && (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <th className="px-3 py-2">Context</th><th className="px-3 py-2">Debit</th><th className="px-3 py-2">Credit</th><th className="px-3 py-2">Tax</th><th className="px-3 py-2">Débours</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {d.posting_rules.length === 0 ? <tr><td colSpan={5} className="px-3 py-4 micro">No posting rules.</td></tr> : d.posting_rules.map((r, i) => (
                <tr key={i}>
                  <td className="px-3 py-2"><Pill tone="mute">{r.applies_context}</Pill></td>
                  <td className="px-3 py-2 num text-xs">{r.debit_account || "—"}{r.debit_label ? <span className="block text-muted-foreground">{r.debit_label}</span> : null}</td>
                  <td className="px-3 py-2 num text-xs">{r.credit_account || "—"}{r.credit_label ? <span className="block text-muted-foreground">{r.credit_label}</span> : null}</td>
                  <td className="px-3 py-2 text-xs">{r.tax_code_id ? "Tax" : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2">{r.is_debours ? <Pill tone="blue">Débours</Pill> : <span className="text-muted-foreground">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "Service tiers" && (
        <div className="space-y-3">
          {it.applicability_mode !== "SERVICE_SCOPED" ? (
            <Callout tone="info" title={it.applicability_mode === "NON_OPERATIONAL" ? "Overhead / admin" : "Any operation"}>
              {it.applicability_mode === "NON_OPERATIONAL" ? "This line is not tied to operations, so it never appears in a service pick-list." : "This line surfaces on every operational dossier, regardless of service type."}
            </Callout>
          ) : d.service_tiers.length === 0 ? <EmptyState title="No service tiers" hint="Add services + a Basic/Advanced/Full tier." /> : (
            (["BASIC", "ADVANCED", "FULL"] as const).map((tier) => {
              const inTier = d.service_tiers.filter((s) => s.tier === tier);
              if (!inTier.length) return null;
              return (
                <div key={tier} className="rounded-lg border">
                  <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase text-muted-foreground">{tier}</div>
                  <ul className="divide-y divide-border">
                    {inTier.map((s) => <li key={s.service_type_id} className="px-3 py-2 text-sm">{s.name_en || s.name_fr}{s.territory ? <span className="ml-2 micro">{s.territory}</span> : null}</li>)}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === "Compliance" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Controls">
            <KV k="Receipt requirement" v={d.compliance.receipt_requirement.replace(/_/g, " ").toLowerCase()} />
            <KV k="Justification required" v={d.compliance.requires_justification ? "Yes" : "No"} />
            <KV k="Proof source" v={d.compliance.proof_source || "—"} />
          </Panel>
          <Panel title="Débours & VAT">
            <KV k="Is débours" v={d.compliance.is_debours ? "Yes (pass-through)" : "No"} />
            <KV k="Shows upstream VAT" v={d.compliance.debours_vat_transparent ? "Yes — client sees VAT paid on their behalf" : "No"} />
            {d.compliance.is_debours && <p className="mt-2 micro">A débours re-bills the VAT-inclusive amount and adds no VAT of ours; the upstream supplier VAT is shown to the client as paid on their behalf, not retained.</p>}
          </Panel>
        </div>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border bg-card p-4"><h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3><div className="space-y-1.5">{children}</div></div>;
}
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="grid grid-cols-[130px_1fr] gap-2 text-sm"><span className="text-muted-foreground">{k}</span><span className="text-foreground">{v}</span></div>;
}
