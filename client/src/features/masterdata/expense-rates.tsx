/**
 * Master data — the Expense Rates 360 (MOD-10).
 *
 * Same master → detail 360 shape as the Financial Dictionary (item-centric):
 * a searchable list rail on the left, a rate dossier on the right. What goes
 * in the dossier is the actual product decision this screen exists for —
 * disbursement items do not have ONE standard rate, they have one rate PER
 * shipping line / airline (Container Maintenance is priced differently by
 * Maersk, MSC, CMA CGM…) or, for a handful of items, one rate per AUTHORITY
 * regardless of carrier (PAD/PAK port fees apply no matter who shipped the
 * box). So the dossier is a grid: rows are carriers (or authorities), columns
 * are container types, and a cell is a rate — plus a "Default rate" tab for
 * the item's plain fallback, used when no carrier-specific row is set.
 *
 * RATES ARE SUPERSEDED, NEVER EDITED — same discipline the Financial
 * Dictionary's own "Cost & evolution" tab documents and reads. Setting a cell
 * calls the SAME `POST /financial-dictionary/:id/rates/supersede` endpoint
 * that tab's history is built from, so this screen and that one are two views
 * over one history, not two competing sources of truth.
 *
 * SCOPE, NOT A NEW CONCEPT. A rate row is scoped by two nullable FKs:
 * `rate_provider_id` (NULL = the item's default, no carrier) and
 * `container_type_ref_id` (NULL = no equipment dimension — an authority fee
 * per BL, an air rate priced by weight). The resolver used by costing
 * (`expense_rate.rules.pickRate`) cascades: an exact carrier+type match wins,
 * then the carrier's general rate, then the default — never a rate that names
 * a DIFFERENT carrier than the one asked for.
 *
 * CARRIERS/AUTHORITIES ARE THEIR OWN CONFIG (`rate_provider`, MOD-10), not
 * hard-coded — a manager adds "Turkish Cargo" from the gear panel or inline
 * from a carrier tab without waiting on a release, same shape as
 * dictionary_ref elsewhere in the product.
 */
import * as React from "react";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Callout } from "@/components/ui/callout";
import { Modal, Field } from "@/components/ui/modal";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { SplitPane } from "@/components/ui/split-pane";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useToast } from "@/components/ui/toast";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, dateFmt, todayISO } from "@/lib/format";
import * as api from "@/lib/masterdata-api";
import { shell } from "./shared";

const DIR_TONE: Record<string, React.ComponentProps<typeof Pill>["tone"]> = { REVENUE: "ok", EXPENSE: "warn", DISBURSEMENT: "blue", ASSET: "orange" };
const dirLabel = (d?: string) => (d ? d[0] + d.slice(1).toLowerCase() : "—");
const DIR_FILTER = [{ value: "", label: "All" }, { value: "DISBURSEMENT", label: "Disbursement" }, { value: "EXPENSE", label: "Expense" }, { value: "REVENUE", label: "Revenue" }, { value: "ASSET", label: "Asset" }];

const seriesKey = (providerId: string | null, containerTypeId: string | null) => `${providerId || ""}|${containerTypeId || ""}`;

/* ══════════════════ Carrier / authority quick-add + settings ══════════════ */

// Land and barge joined at 0666 — a subcontracted haul is priced off a rate
// card like any other leg, and until the kinds existed the haulier on an
// inland file was a name typed into details_json.
const PROVIDER_KIND_TABS: { kind: api.RateProviderKind; label: string }[] = [
  { kind: "SHIPPING_LINE", label: "Sea carriers" },
  { kind: "AIRLINE", label: "Air carriers" },
  { kind: "TRUCKING", label: "Hauliers" },
  { kind: "RAIL", label: "Rail" },
  { kind: "BARGE", label: "Barge" },
  { kind: "COURIER", label: "Couriers" },
  { kind: "PORT_AUTHORITY", label: "Port authorities" },
  { kind: "CUSTOMS_AUTHORITY", label: "Customs authorities" },
  { kind: "OTHER", label: "Other" },
];

function ProviderManager({ kind }: { kind: api.RateProviderKind }) {
  const toast = useToast();
  const list = useResource(() => api.listRateProviders({ kind }), [kind]);
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ code: "", name: "", carrier_code: "" });
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!form.code || !form.name) { toast.error("Code and name are required"); return; }
    setBusy(true);
    try {
      await api.createRateProvider({ kind, code: form.code, name: form.name, carrier_code: form.carrier_code || undefined });
      toast.success("Added"); setForm({ code: "", name: "", carrier_code: "" }); setAdding(false); list.reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }
  async function toggle(r: api.RateProvider) {
    try { await api.updateRateProvider(r.rate_provider_id, { is_active: !(r.is_active ?? true) }); list.reload(); }
    catch (e) { toast.error(errMsg(e)); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="micro">Seeded rows are marked <em>System</em> but stay editable. Add as many as you carry.</p>
        <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>+ Add new</Button>
      </div>
      {adding && (
        <div className="rounded-lg border bg-card p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Input placeholder="CODE" value={form.code} onChange={(e) => setForm((s) => ({ ...s, code: e.target.value.toUpperCase() }))} />
            <Input placeholder="Name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
            <Input placeholder="SCAC / IATA (optional)" value={form.carrier_code} onChange={(e) => setForm((s) => ({ ...s, carrier_code: e.target.value }))} />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setForm({ code: "", name: "", carrier_code: "" }); }}>Cancel</Button>
            <Button size="sm" loading={busy} onClick={submit}>Add</Button>
          </div>
        </div>
      )}
      {list.loading ? <LoadingRow label="Loading…" /> : list.error ? <ErrorState message={list.error} /> : (list.data || []).length === 0 ? <EmptyState title="Nothing yet" hint="Add your first carrier." /> : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {(list.data || []).map((r) => (
                <tr key={r.rate_provider_id} className={r.is_active === false ? "opacity-50" : ""}>
                  <td className="px-3 py-1.5 num font-medium text-foreground">{r.code}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.name}{r.carrier_code ? ` · ${r.carrier_code}` : ""}</td>
                  <td className="px-3 py-1.5">{r.is_system && <Pill tone="mute">System</Pill>}</td>
                  <td className="px-3 py-1.5 text-right"><button onClick={() => toggle(r)} className="text-sm text-primary-ink underline">{(r.is_active ?? true) ? "Deactivate" : "Activate"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RateProviderSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = React.useState<api.RateProviderKind>("SHIPPING_LINE");
  if (!open) return null;
  return (
    <Modal open onClose={onClose} title="Carriers & authorities" description="The seeded-but-editable list every rate scope picks from — extend it here or inline from a carrier tab.">
      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {PROVIDER_KIND_TABS.map((k) => (
          <button key={k.kind} onClick={() => setKind(k.kind)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${kind === k.kind ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="max-h-[60vh] overflow-auto pr-1"><ProviderManager kind={kind} /></div>
    </Modal>
  );
}

function QuickAddProvider({ kind, onAdded }: { kind: api.RateProviderKind; onAdded: () => void }) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!code || !name) { toast.error("Code and name are required"); return; }
    setBusy(true);
    try {
      await api.createRateProvider({ kind, code, name });
      toast.success(`${name} added`);
      setCode(""); setName(""); setOpen(false);
      onAdded();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }

  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>+ Add carrier</Button>;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-2">
      <Input placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="w-28" />
      <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="w-48" />
      <Button size="sm" loading={busy} onClick={submit}>Add</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

/* ══════════════════════════ Set-rate modal ═════════════════════════════ */

function SetRateModal({
  itemId, currency, providerLabel, providerId, containerTypeId, containerTypeLabel, current, onClose, onSaved,
}: {
  itemId: string; currency: string; providerLabel: string; providerId: string | null;
  containerTypeId: string | null; containerTypeLabel: string | null;
  current: api.RatePoint | null; onClose: () => void; onSaved: () => void;
}) {
  const [rate, setRate] = React.useState(current ? String(current.rate) : "");
  const [curr, setCurr] = React.useState(current?.currency || currency || "XAF");
  const [from, setFrom] = React.useState(todayISO());
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.supersedeDictRate(itemId, {
        rate: Number(rate), currency: curr, effective_from: from,
        rate_provider_id: providerId, container_type_ref_id: containerTypeId,
        note: note || undefined,
      });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Set rate — ${providerLabel}${containerTypeLabel ? " · " + containerTypeLabel : ""}`}
      description="Rates are superseded, never edited in place — the prior rate expires the day before this one opens, so history stays intact.">
      <form className="space-y-4" onSubmit={submit}>
        {current && <Callout tone="info" title="Current rate">{money(current.rate, current.currency || curr)} since {dateFmt(current.effective_from)}</Callout>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rate" required><Input type="number" min="0" step="0.01" className="num text-right" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
          <Field label="Currency"><Input value={curr} onChange={(e) => setCurr(e.target.value.toUpperCase().slice(0, 3))} /></Field>
          <Field label="Effective from" required><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={rate === "" || !from || busy} onCancel={onClose} saveLabel="Save rate" />
      </form>
    </Modal>
  );
}

/* ══════════════════════════════ Rate grids ═════════════════════════════ */

function RateCell({ series, onClick }: { series?: api.RateSeries; onClick: () => void }) {
  const cur = series?.current;
  return (
    <button type="button" onClick={onClick}
      className={`w-full rounded-md px-2 py-1.5 text-right text-xs hover:bg-muted ${cur ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
      {cur ? money(cur.rate, cur.currency || series?.currency) : "— set"}
    </button>
  );
}

function DefaultRateGrid({
  variesByEquipment, containerTypes, seriesMap, onEdit,
}: {
  variesByEquipment?: boolean; containerTypes: api.DictRef[];
  seriesMap: Map<string, api.RateSeries>; onEdit: (type: api.DictRef | null) => void;
}) {
  if (!variesByEquipment) {
    const series = seriesMap.get(seriesKey(null, null));
    return (
      <div className="flex items-center justify-between rounded-xl border bg-card p-4">
        <div><p className="text-sm font-semibold text-foreground">Standard rate</p><p className="micro">Applies when no carrier-specific rate is set for this item.</p></div>
        <div className="w-32"><RateCell series={series} onClick={() => onEdit(null)} /></div>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><th className="px-3 py-2">Container type</th><th className="px-3 py-2 text-right">Standard rate</th></tr></thead>
        <tbody className="divide-y divide-border">
          {containerTypes.map((ct) => (
            <tr key={ct.ref_id}>
              <td className="px-3 py-1.5">{ct.name_en || ct.name_fr} <span className="micro">{ct.code}</span></td>
              <td className="px-1 py-1"><RateCell series={seriesMap.get(seriesKey(null, ct.ref_id))} onClick={() => onEdit(ct)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CarrierRateGrid({
  providers, variesByEquipment, containerTypes, seriesMap, onEdit, onAdded, addKind,
}: {
  providers: api.RateProvider[]; variesByEquipment?: boolean; containerTypes: api.DictRef[];
  seriesMap: Map<string, api.RateSeries>; onEdit: (provider: api.RateProvider, type: api.DictRef | null) => void;
  onAdded: () => void; addKind: api.RateProviderKind;
}) {
  return (
    <div className="space-y-3">
      {providers.length === 0 ? (
        <EmptyState title="No carriers configured yet" hint="Add one below to start rating this item." />
      ) : !variesByEquipment ? (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><th className="px-3 py-2">Carrier</th><th className="px-3 py-2 text-right">Rate</th></tr></thead>
            <tbody className="divide-y divide-border">
              {providers.map((p) => (
                <tr key={p.rate_provider_id}>
                  <td className="px-3 py-1.5 font-medium text-foreground">{p.name}{p.carrier_code ? <span className="ml-1.5 micro">{p.carrier_code}</span> : null}</td>
                  <td className="w-40 px-1 py-1"><RateCell series={seriesMap.get(seriesKey(p.rate_provider_id, null))} onClick={() => onEdit(p, null)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2">Carrier</th>
              {containerTypes.map((ct) => <th key={ct.ref_id} className="whitespace-nowrap px-2 py-2 text-right">{ct.code}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border">
              {providers.map((p) => (
                <tr key={p.rate_provider_id}>
                  <td className="sticky left-0 z-10 bg-card px-3 py-1.5 font-medium text-foreground">{p.name}</td>
                  {containerTypes.map((ct) => (
                    <td key={ct.ref_id} className="min-w-[88px] px-1 py-1">
                      <RateCell series={seriesMap.get(seriesKey(p.rate_provider_id, ct.ref_id))} onClick={() => onEdit(p, ct)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <QuickAddProvider kind={addKind} onAdded={onAdded} />
    </div>
  );
}

/* ══════════════════════════════ The dossier ════════════════════════════ */

// "Land" is one tab over four kinds deliberately: a rate card for a corridor
// haul is the same document whether the leg runs on a truck, a wagon or a
// barge, and four near-empty tabs would read as four separate rate stories.
const RATE_TABS = ["Default rate", "Sea carriers", "Air carriers", "Land", "Authorities"] as const;
type RateTab = (typeof RATE_TABS)[number];
const TAB_KINDS: Record<Exclude<RateTab, "Default rate">, api.RateProviderKind[]> = {
  "Sea carriers": ["SHIPPING_LINE"],
  "Air carriers": ["AIRLINE"],
  Land: ["TRUCKING", "RAIL", "BARGE", "COURIER"],
  Authorities: ["PORT_AUTHORITY", "CUSTOMS_AUTHORITY"],
};

function RateDossier({ item, onChanged }: { item: api.DictItem; onChanged: () => void }) {
  const id = item.dictionary_item_id;
  const hist = useResource(() => api.dictRateHistory(id), [id]);
  const providersRes = useResource(() => api.listRateProviders({ active: true }), []);
  const typesRes = useResource(() => api.listDictRefs("CONTAINER_TYPE"), []);
  const [tab, setTab] = React.useState<RateTab>("Default rate");
  const [editing, setEditing] = React.useState<{ provider: api.RateProvider | null; type: api.DictRef | null } | null>(null);

  const seriesMap = React.useMemo(() => {
    const m = new Map<string, api.RateSeries>();
    (hist.data?.series || []).forEach((s) => m.set(seriesKey(s.rate_provider_id ?? null, s.container_type_ref_id ?? null), s));
    return m;
  }, [hist.data]);

  if (hist.loading || providersRes.loading || typesRes.loading) return <LoadingRow label="Loading rates…" />;
  if (hist.error) return <ErrorState message={hist.error} />;

  const containerTypes = item.varies_by_equipment ? (typesRes.data || []) : [];
  const isFormula = item.pricing_mode === "FORMULA";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-sm font-bold text-foreground">{item.code}</span>
              <h2 className="truncate text-lg font-semibold text-foreground">{item.label_en || item.label_fr}</h2>
              <Pill tone={DIR_TONE[item.direction] || "mute"}>{dirLabel(item.direction)}</Pill>
              {item.varies_by_equipment && <Pill tone="blue">Varies by container type</Pill>}
              {isFormula && <Pill tone="warn">Formula-priced</Pill>}
            </div>
            <p className="mt-1 micro">{[item.category, item.subcategory].filter(Boolean).join(" · ")} · default currency {item.currency || "XAF"}</p>
          </div>
        </div>
      </div>

      {isFormula && (
        <Callout tone="warn" title="Priced by a tariff, not a flat rate">
          Demurrage/storage-style charges depend on free days and elapsed time — the real calculation lives in the Extra
          Charges Simulation module. The rate below is a reference / starting figure that still resolves for costing when
          the simulator has not been run.
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={() => { window.location.href = "/commercial/extra-charge-simulation"; }}>
              Open Extra Charges Simulation →
            </Button>
          </div>
        </Callout>
      )}

      <div className="flex flex-wrap gap-1 border-b">
        {RATE_TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Default rate" && (
        <DefaultRateGrid variesByEquipment={item.varies_by_equipment} containerTypes={containerTypes} seriesMap={seriesMap}
          onEdit={(type) => setEditing({ provider: null, type })} />
      )}
      {tab !== "Default rate" && (
        <CarrierRateGrid
          providers={(providersRes.data || []).filter((p) => TAB_KINDS[tab].includes(p.kind))}
          variesByEquipment={item.varies_by_equipment}
          containerTypes={containerTypes}
          seriesMap={seriesMap}
          onEdit={(provider, type) => setEditing({ provider, type })}
          onAdded={providersRes.reload}
          addKind={TAB_KINDS[tab][0]}
        />
      )}

      {editing && (
        <SetRateModal
          itemId={id}
          currency={item.currency || "XAF"}
          providerId={editing.provider?.rate_provider_id ?? null}
          providerLabel={editing.provider?.name ?? "Default (no carrier)"}
          containerTypeId={editing.type?.ref_id ?? null}
          containerTypeLabel={editing.type ? (editing.type.name_en || editing.type.name_fr) : null}
          current={seriesMap.get(seriesKey(editing.provider?.rate_provider_id ?? null, editing.type?.ref_id ?? null))?.current || null}
          onClose={() => setEditing(null)}
          onSaved={() => { hist.reload(); onChanged(); }}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════ Page shell ═════════════════════════════ */

export function ExpenseRatesPage() {
  const [q, setQ] = React.useState("");
  const [dir, setDir] = React.useState<string>("");
  const list = useResource(() => api.listDict({ q: q || undefined, direction: (dir || undefined) as api.Direction | undefined }), [q, dir]);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState(false);

  const rows = React.useMemo(() => list.data || [], [list.data]);
  React.useEffect(() => { if (!selId && rows.length) setSelId(rows[0].dictionary_item_id); }, [rows, selId]);
  const selected = rows.find((r) => r.dictionary_item_id === selId) || null;

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Master data" to="/master" />}
        title="Expense rates"
        description="Rates per shipping line, airline and authority — feeds costing and the financial dictionary picker."
        action={<Button variant="ghost" size="sm" onClick={() => setSettings(true)}>⚙ Carriers & authorities</Button>}
      />
      <HubTabs />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input placeholder="Search code or name…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Segmented label="Direction filter" value={dir} onChange={setDir} options={DIR_FILTER} />
      </div>

      {list.error ? <ErrorState message={list.error} /> : (
        <SplitPane storageKey="master.expense-rates" label="Item list width" defaultSize={300} min={240} max={520}>
          <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
            {list.loading ? <LoadingRow label="Loading items…" /> : rows.length === 0 ? <div className="px-3 py-4 micro">No items.</div> : rows.map((r) => (
              <button key={r.dictionary_item_id} onClick={() => setSelId(r.dictionary_item_id)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${r.dictionary_item_id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}>
                <span className="min-w-0">
                  <span className="num text-xs font-semibold text-foreground">{r.code}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.label_en || r.label_fr}</span>
                </span>
                {r.pricing_mode === "FORMULA" ? <Pill tone="warn">Formula</Pill> : <Pill tone={DIR_TONE[r.direction] || "mute"}>{dirLabel(r.direction)}</Pill>}
              </button>
            ))}
          </div>
          {selected ? <RateDossier item={selected} onChanged={list.reload} /> : <EmptyState title="No item selected" hint="Choose a line from the list." />}
        </SplitPane>
      )}

      {settings && <RateProviderSettings open={settings} onClose={() => setSettings(false)} />}
      <ScreenAi path="master/expense-rates" />
    </section>
  );
}
