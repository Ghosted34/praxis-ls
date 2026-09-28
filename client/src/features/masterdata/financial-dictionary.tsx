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
import { IndexRow } from "@/components/ui/index-row";
import { tr } from "@/lib/i18n";
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
import { SectionTabs } from "@/components/ui/section-tabs";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt } from "@/lib/format";
import * as api from "@/lib/masterdata-api";
import { DictForm } from "./financial-dictionary-form";
import { FinancialDictionarySettings } from "./financial-dictionary-settings";
import { SpendTab, CostEvolutionTab } from "./financial-dictionary-spend";
import { DictImportModal } from "./financial-dictionary-import";
import { DictUsageDrill } from "./financial-dictionary-usage";
import { SetRateModal } from "./rate-modals";
import { PencilIcon } from "@/components/ui/icons";
import { dictLabel } from "@/lib/dict-label";
import { isDesktopNow } from "@/lib/use-media-query";

const shell = pageShell.wide;

const DIR_TONE: Record<string, React.ComponentProps<typeof Pill>["tone"]> = {
  REVENUE: "ok",
  EXPENSE: "warn",
  DISBURSEMENT: "blue",
  ASSET: "orange",
};
const dirLabel = (d?: string) => (d ? d[0] + d.slice(1).toLowerCase() : "—");
const DIR_FILTER = [
  { value: "", label: "All" },
  { value: "REVENUE", label: "Revenue" },
  { value: "EXPENSE", label: "Expense" },
  { value: "DISBURSEMENT", label: "Disbursement" },
  { value: "ASSET", label: "Asset" },
];

export function FinancialDictionaryPage() {
  const [q, setQ] = React.useState("");
  const [dir, setDir] = React.useState<string>("");
  const list = useResource(
    () =>
      api.listDict({
        q: q || undefined,
        direction: (dir || undefined) as api.Direction | undefined,
      }),
    [q, dir],
  );
  const [selId, setSelId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<api.DictFull | "new" | null>(
    null,
  );
  const [settings, setSettings] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  const rows = React.useMemo(() => list.data || [], [list.data]);
  // The first line opens by itself beside a desktop's detail pane. Not on a
  // phone: there the line opens as a full-screen sheet, and opening it unasked
  // would cover the list the reader came to (SplitPane `onClose`).
  React.useEffect(() => {
    if (!selId && rows.length && isDesktopNow())
      setSelId(rows[0].dictionary_item_id);
  }, [rows, selId]);
  const selectedRow = rows.find((r) => r.dictionary_item_id === selId);

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Master data" to="/master" />}
        title="Financial dictionary"
        description="Priced lines with their OHADA posting rules — the single source every quote, invoice and costing reads."
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSettings(true)}>
              ⚙ Settings
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImporting(true)}
            >
              Import
            </Button>
            <Button onClick={() => setEditing("new")}>New item</Button>
          </div>
        }
      />
      <HubTabs />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search code or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Segmented
          label="Direction filter"
          value={dir}
          onChange={setDir}
          options={DIR_FILTER}
        />
      </div>

      {list.error ? (
        <ErrorState message={list.error} />
      ) : (
        <SplitPane
          storageKey="master.dictionary"
          label="Dictionary list width"
          defaultSize={300}
          min={240}
          max={520}
          activeKind={tr("Dictionary item")}
          active={!!selId}
          onClose={() => setSelId(null)}
          sheetTitle={
            selectedRow
              ? `${selectedRow.code} · ${selectedRow.label_en || selectedRow.label_fr || ""}`
              : null
          }
        >
          {/* Its own scroller beside a desktop's detail pane; on a phone the
              list IS the page, so it flows with the page's one scroll. */}
          <div className="space-y-1 rounded-lg border p-1 lg:max-h-[70vh] lg:overflow-auto">
            {list.loading ? (
              <LoadingRow label="Loading dictionary…" />
            ) : rows.length === 0 ? (
              <div className="px-3 py-4 micro">No items.</div>
            ) : (
              rows.map((r) => (
                <IndexRow
                  key={r.dictionary_item_id}
                  selected={r.dictionary_item_id === selId}
                  onClick={() => setSelId(r.dictionary_item_id)}
                  className="items-center justify-between gap-2"
                >
                  <span className="min-w-0">
                    <span className="num text-xs font-semibold text-foreground">
                      {r.code}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.label_en || r.label_fr}
                    </span>
                  </span>
                  <Pill tone={DIR_TONE[r.direction] || "mute"}>
                    {dirLabel(r.direction)}
                  </Pill>
                </IndexRow>
              ))
            )}
          </div>
          {selId ? (
            <DictDossier
              id={selId}
              onEdit={(d) => setEditing(d)}
              onChanged={list.reload}
            />
          ) : (
            <EmptyState
              title="No item selected"
              hint="Choose a line from the list."
            />
          )}
        </SplitPane>
      )}

      {editing !== null && (
        <DictForm
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={list.reload}
        />
      )}
      {/* onImported fires on COMMIT, not on close, so imported rows appear in
          the rail immediately — the modal stays open showing what was rejected. */}
      <DictImportModal
        open={importing}
        onClose={() => setImporting(false)}
        onImported={list.reload}
      />
      <FinancialDictionarySettings
        open={settings}
        onClose={() => setSettings(false)}
      />
      <ScreenAi path="master/financial-dictionary" />
    </section>
  );
}

/** Each drill-in's tile figure, so the dialog can tell when its total falls
 *  short of the number that was clicked. */
const USAGE_COUNT: Record<api.DictUsageKind, (u: api.DictUsage) => number> = {
  costings: (u) => u.costing_lines,
  cash_requests: (u) => u.cash_request_lines,
  invoices: (u) => u.invoice_lines,
  purchase_orders: (u) => u.purchase_order_items,
  rates: (u) => u.expense_rates,
};

const TABS = [
  "Overview",
  "Spend",
  "Cost & evolution",
  "OHADA posting",
  "Service tiers",
  "Compliance",
] as const;
type Tab = (typeof TABS)[number];

function DictDossier({
  id,
  onEdit,
  onChanged,
}: {
  id: string;
  onEdit: (d: api.DictFull) => void;
  onChanged: () => void;
}) {
  const dossier = useResource(() => api.dictDossier(id), [id]);
  const [tab, setTab] = React.useState<Tab>("Overview");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [pricing, setPricing] = React.useState(false);
  // Which usage tile's list is open, if any.
  const [drill, setDrill] = React.useState<api.DictUsageKind | null>(null);

  if (dossier.loading) return <LoadingRow label="Loading 360…" />;
  if (dossier.error) return <ErrorState message={dossier.error} />;
  if (!dossier.data)
    return (
      <EmptyState title={tr("Not found")} hint="This item may have been removed." />
    );

  const d = dossier.data;
  const it = d.item;
  const u = d.usage;

  async function toggleActive() {
    setBusy(true);
    setErr(null);
    try {
      await api.updateDict(id, { is_active: !it.is_active });
      dossier.reload();
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-sm font-bold text-foreground">
                {it.code}
              </span>
              {/* h2 (not h3): PageHeader is the page's only h1, so the dossier
                  heading is the next level down (heading-order, WCAG 1.3.1). */}
              <h2 className="truncate text-lg font-semibold text-foreground">
                {it.label_en || it.label_fr}
              </h2>
              <Pill tone={DIR_TONE[it.direction] || "mute"}>
                {dirLabel(it.direction)}
              </Pill>
              <Pill tone={it.is_active ? "ok" : "mute"}>
                {it.is_active ? "Active" : "Inactive"}
              </Pill>
              {it.is_disbursement && <Pill tone="blue">{tr("Disbursement")}</Pill>}
            </div>
            <p className="mt-1 micro">
              {[
                it.label_fr,
                it.category,
                it.subcategory,
                it.applicability_mode?.replace(/_/g, " ").toLowerCase(),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => onEdit(d.item)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={busy}
              onClick={toggleActive}
            >
              {it.is_active ? "Deactivate" : "Activate"}
            </Button>
          </div>
        </div>
        {err && (
          <div className="mt-3">
            <ErrorState message={err} />
          </div>
        )}
        {d.compliance.needs_attention && (
          <div className="mt-3">
            <Callout tone="warn" title="Compliance gap">
              This line always requires a receipt but names no valid proof
              source. Set one so cash requests can be checked.
            </Callout>
          </div>
        )}
      </div>

      {/* Usage KPI strip — every tile opens the rows it counts, a page at a
          time, with a way out to the module that owns them
          (./financial-dictionary-usage). A zero opens too: "none yet" is an
          answer, and the dialog's link is still the way to the module. */}
      <KpiRow stack>
        <KpiTile
          label="Costings"
          value={num(u.costing_lines)}
          onClick={() => setDrill("costings")}
        />
        <KpiTile
          label="Cash requests"
          value={num(u.cash_request_lines)}
          onClick={() => setDrill("cash_requests")}
        />
        <KpiTile
          label={tr("Invoices")}
          value={num(u.invoice_lines)}
          onClick={() => setDrill("invoices")}
        />
        <KpiTile
          label={tr("Purchase orders")}
          value={num(u.purchase_order_items)}
          onClick={() => setDrill("purchase_orders")}
        />
        <KpiTile
          label={tr("Rates")}
          value={num(u.expense_rates)}
          onClick={() => setDrill("rates")}
        />
      </KpiRow>
      {drill && (
        <DictUsageDrill
          item={it}
          kind={drill}
          count={USAGE_COUNT[drill](u)}
          onClose={() => setDrill(null)}
        />
      )}

      {/* One row on a phone — see `section-tabs.tsx`. */}
      <SectionTabs
        label="Charge sections"
        value={tab}
        onChange={setTab}
        sticky
        className="mb-4"
        tabs={TABS.map((t) => ({
          value: t,
          label: t,
          // Only "Service tiers" carries a count, and only when it has one.
          count: t === "Service tiers" ? d.service_tiers.length : undefined,
        }))}
      />

      {tab === "Overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={tr("Identity")}>
            <KV k="Code" v={<span className="num">{it.code}</span>} />
            <KV k="Name (FR)" v={it.label_fr || "—"} />
            <KV k="Name (EN)" v={it.label_en || "—"} />
            <KV k="Direction" v={dirLabel(it.direction)} />
            <KV
              k="Category"
              v={it.category + (it.subcategory ? ` · ${it.subcategory}` : "")}
            />
            <KV
              k="Applicability"
              v={it.applicability_mode?.replace(/_/g, " ").toLowerCase()}
            />
          </Panel>
          <Panel title="Commercials">
            {/* The line's own price is its STANDARD expense rate — the same
                number Expense Rates shows and costing uses (14120). The pencil
                opens the same "Set rate" dialog as that screen, and is offered
                only to someone who may edit rates: dictionary access alone
                must not change what a line costs (meeting 5, 01:17:37). */}
            <KV
              k="Standard rate"
              v={
                <span className="inline-flex items-center gap-1.5">
                  <span>
                    {it.default_price != null
                      ? money(
                          it.default_price,
                          it.default_price_currency || it.currency || "XAF",
                        )
                      : tr("Not set")}
                    {it.default_price != null && it.default_price_from ? (
                      <span className="ml-1.5 micro">
                        {tr("since")} {dateFmt(it.default_price_from)}
                      </span>
                    ) : null}
                  </span>
                  {d.capabilities?.edit_rates && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setPricing(true)}
                      aria-label={tr("Edit standard rate")}
                      title={tr("Edit standard rate")}
                    >
                      <PencilIcon width={14} height={14} />
                    </Button>
                  )}
                </span>
              }
            />
            {it.varies_by_equipment && (
              <p className="micro">
                {tr("Priced per container type — set those in Expense rates.")}
              </p>
            )}
            <KV
              k="Client heading"
              v={dictLabel({ label_en: it.client_heading_en, label_fr: it.client_heading_fr }) || tr("Other Charges")}
            />
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
      {pricing && (
        <SetRateModal
          itemId={id}
          title={`${tr("Standard rate")} — ${it.label_en || it.label_fr}`}
          providerLabel={tr("Standard rate")}
          providerId={null}
          containerTypeId={null}
          containerTypeLabel={null}
          current={
            it.default_price != null && it.default_price_rate_id
              ? {
                  expense_rate_id: it.default_price_rate_id,
                  rate: Number(it.default_price),
                  currency: it.default_price_currency || it.currency || "XAF",
                  effective_from: it.default_price_from || "",
                  in_force: true,
                  superseded: false,
                }
              : null
          }
          onClose={() => setPricing(false)}
          onSaved={() => {
            dossier.reload();
            onChanged();
          }}
        />
      )}

      {tab === "Spend" && <SpendTab id={id} />}
      {tab === "Cost & evolution" && <CostEvolutionTab id={id} />}

      {tab === "OHADA posting" && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Context</th>
                <th className="px-3 py-2">{tr("Debit")}</th>
                <th className="px-3 py-2">{tr("Credit")}</th>
                <th className="px-3 py-2">{tr("Tax")}</th>
                <th className="px-3 py-2">{tr("Disbursement")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.posting_rules.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 micro">
                    No posting rules.
                  </td>
                </tr>
              ) : (
                d.posting_rules.map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <Pill tone="mute">{r.applies_context}</Pill>
                    </td>
                    <td className="px-3 py-2 num text-xs">
                      {r.debit_account || "—"}
                      {r.debit_label ? (
                        <span className="block text-muted-foreground">
                          {r.debit_label}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 num text-xs">
                      {r.credit_account || "—"}
                      {r.credit_label ? (
                        <span className="block text-muted-foreground">
                          {r.credit_label}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.tax_code_id ? (
                        "Tax"
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.is_disbursement ? (
                        <Pill tone="blue">{tr("Disbursement")}</Pill>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "Service tiers" && (
        <div className="space-y-3">
          {it.applicability_mode !== "SERVICE_SCOPED" ? (
            <Callout
              tone="info"
              title={
                it.applicability_mode === "NON_OPERATIONAL"
                  ? "Overhead / admin"
                  : "Any operation"
              }
            >
              {it.applicability_mode === "NON_OPERATIONAL"
                ? "This line is not tied to operations, so it never appears in a service pick-list."
                : "This line surfaces on every operations file, regardless of service type."}
            </Callout>
          ) : d.service_tiers.length === 0 ? (
            <EmptyState
              title="No services yet"
              hint="Add the services this line belongs to, and tick Core where it belongs on almost every file."
            />
          ) : (
            // Core (offered ticked by Suggest charges) or one of the service's
            // more charges (offered unticked) — meeting 5; BASIC = core.
            ([
              { key: "core", title: tr("Core — offered ticked"), core: true },
              { key: "more", title: tr("More charges — offered unticked"), core: false },
            ] as const).map((band) => {
              const inTier = d.service_tiers.filter((s) => (s.tier === "BASIC") === band.core);
              if (!inTier.length) return null;
              return (
                <div key={band.key} className="rounded-lg border">
                  <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase text-muted-foreground">
                    {band.title}
                  </div>
                  <ul className="divide-y divide-border">
                    {inTier.map((s) => (
                      <li key={s.service_type_id} className="px-3 py-2 text-sm">
                        {s.name_en || s.name_fr}
                        {s.territory ? (
                          <span className="ml-2 micro">{s.territory}</span>
                        ) : null}
                      </li>
                    ))}
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
            <KV
              k="Receipt requirement"
              v={d.compliance.receipt_requirement
                .replace(/_/g, " ")
                .toLowerCase()}
            />
            <KV
              k="Justification required"
              v={d.compliance.requires_justification ? "Yes" : "No"}
            />
            <KV k="Proof source" v={d.compliance.proof_source || "—"} />
          </Panel>
          <Panel title="Disbursement & VAT">
            <KV
              k="Is débours"
              v={d.compliance.is_disbursement ? "Yes (pass-through)" : "No"}
            />
            <KV
              k="Shows upstream VAT"
              v={
                d.compliance.disbursement_vat_transparent
                  ? "Yes — client sees VAT paid on their behalf"
                  : "No"
              }
            />
            {d.compliance.is_disbursement && (
              <p className="mt-2 micro">
                A débours re-bills the VAT-inclusive amount and adds no VAT of
                ours; the upstream supplier VAT is shown to the client as paid
                on their behalf, not retained.
              </p>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground">{v}</span>
    </div>
  );
}
