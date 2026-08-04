/**
 * The shared report viewer: dynamic-shape rendering, period filters, and the
 * tabbed shell that Statements and the Tax centre both mount.
 *
 * Split out of `features/finance/pages.tsx` in Phase 3 (audit F7). Two screens
 * used these and they were private to a 2,581-line module.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { tenant, ApiError } from "@/lib/api-client";
import { smartCell } from "@/lib/format";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/modal";
import * as fin from "@/lib/finance-api";
import type { Period } from "@/lib/finance-api";
import { useOptions, optionLabel } from "./shared";

const keyLabel = (k: string): string => {
  // single-digit keys in statements are SYSCOHADA account classes
  if (/^[1-9]$/.test(k)) return `Class ${k}`;
  const s = k.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function ReportTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <EmptyState title="Nothing to show" hint="The report returned no rows." />;
  const cols = Object.keys(rows[0]).slice(0, 8);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <Table>
        <THead>
          <TR>
            {cols.map((c) => (
              <TH key={c}>{keyLabel(c)}</TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {rows.map((r, i) => (
            <TR key={i}>
              {cols.map((c) => (
                <TD key={c} className="num text-sm">
                  {smartCell(r[c])}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function KVCard({ title, entries }: { title?: string; entries: [string, unknown][] }) {
  return (
    <div className="lux-card divide-y">
      {title && <div className="px-5 py-2.5 text-sm font-semibold">{title}</div>}
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4 px-5 py-3">
          <span className="text-sm text-muted-foreground">{keyLabel(k)}</span>
          <span className="num text-sm font-medium">{smartCell(v)}</span>
        </div>
      ))}
    </div>
  );
}

/** Statement/report payloads come in three shapes: a plain array of rows, an
 *  object wrapping a rows array + totals (trial balance, grand livre), or an
 *  object of figures with nested groups (notes: class_balances). Render each
 *  part properly — line items as tables, nested groups as their own card —
 *  instead of collapsing them to "5 items" / truncated pairs. */
function Report({ data }: { data: unknown }) {
  if (Array.isArray(data)) return <ReportTable rows={data as Record<string, unknown>[]} />;
  const entries = data && typeof data === "object" ? Object.entries(data as Record<string, unknown>) : [];
  if (entries.length === 0) return <EmptyState title="No data" hint="The report returned nothing for this period." />;

  const arrays = entries.filter((e): e is [string, Record<string, unknown>[]] => Array.isArray(e[1]));
  const objects = entries.filter((e): e is [string, Record<string, unknown>] => !!e[1] && typeof e[1] === "object" && !Array.isArray(e[1]));
  const scalars = entries.filter(([, v]) => !v || typeof v !== "object");

  return (
    <div className="space-y-4">
      {arrays.map(([k, rows]) => (
        <div key={k}>
          {arrays.length + objects.length + scalars.length > 1 && <div className="micro mb-2 uppercase tracking-wide">{keyLabel(k)}</div>}
          {rows.length && typeof rows[0] === "object" && !Array.isArray(rows[0]) ? (
            <ReportTable rows={rows} />
          ) : (
            <span className="micro">{rows.length ? rows.map((x) => smartCell(x)).join(" · ") : "No rows."}</span>
          )}
        </div>
      ))}
      {scalars.length > 0 && <KVCard entries={scalars} />}
      {objects.map(([k, obj]) => (
        <KVCard key={k} title={keyLabel(k)} entries={Object.entries(obj)} />
      ))}
    </div>
  );
}

type Params = { entity_id: string; period_code: string; period_id: string; from: string; to: string };
const EMPTY_PARAMS: Params = { entity_id: "", period_code: "", period_id: "", from: "", to: "" };

function toQuery(p: Params): string {
  const qs = new URLSearchParams();
  if (p.entity_id) qs.set("entity_id", p.entity_id);
  // Statements key on period_id; tax reports on period_code — send whichever is set.
  if (p.period_id) qs.set("period_id", p.period_id);
  if (p.period_code) qs.set("period_code", p.period_code);
  if (p.from) qs.set("from", p.from);
  if (p.to) qs.set("to", p.to);
  const s = qs.toString();
  return s ? `?${s}` : "";
}
type Tab = { key: string; label: string; path?: string; render?: () => React.ReactNode };

export function ReportTabs({
  title,
  description,
  tabs,
  periodMode = "period_code",
}: {
  title: string;
  description: string;
  tabs: Tab[];
  /** Statements bind on `period_id` (dropdown from /statements/periods); tax on `period_code`. */
  periodMode?: "period_code" | "period_id";
}) {
  const [active, setActive] = React.useState(tabs[0].key);
  const [data, setData] = React.useState<unknown>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  // draft holds the input values; `params` is the applied set that actually fetches
  const [draft, setDraft] = React.useState<Params>(EMPTY_PARAMS);
  const [params, setParams] = React.useState<Params>(EMPTY_PARAMS);
  const { opts: entities } = useOptions(fin.loadEntities, true);

  // Period dropdown for statement-mode: loaded once, filtered by the chosen entity.
  const [periods, setPeriods] = React.useState<Period[]>([]);
  React.useEffect(() => {
    if (periodMode !== "period_id") return;
    let live = true;
    fin.listPeriods()
      .then((d) => live && setPeriods(d.periods || []))
      .catch(() => {
        /* dropdown just stays empty; from/to still work */
      });
    return () => {
      live = false;
    };
  }, [periodMode]);
  const periodOptions = periods.filter((p) => !draft.entity_id || !p.entity_id || p.entity_id === draft.entity_id);

  const activeTab = tabs.find((t) => t.key === active)!;
  const isCustom = !!activeTab.render;
  const path = (activeTab.path ?? "") + toQuery(params);

  React.useEffect(() => {
    if (isCustom || !activeTab.path) return; // custom-render tabs fetch nothing
    let live = true;
    setLoading(true);
    setError(null);
    setData(null);
    tenant<unknown>(path)
      .then((d) => live && setData(d))
      .catch((err) => {
        if (!live) return;
        if (err instanceof ApiError && err.status === 403) setError("You don't have permission to view this.");
        else setError(err instanceof ApiError ? err.message : "Failed to load.");
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, isCustom, activeTab.path]);

  return (
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Finance" to="/finance" />} title={title} description={description} />

      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={
              "border-b-2 px-3 py-2 text-sm transition-colors " +
              (active === t.key
                ? "border-[rgb(var(--brand-orange))] font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {isCustom ? (
        activeTab.render!()
      ) : (
        <>
          <div className="lux-card mb-4 flex flex-wrap items-end gap-3 p-4">
            <Field label="Entity" className="min-w-[12rem]">
              <Select value={draft.entity_id} onChange={(e) => setDraft({ ...draft, entity_id: e.target.value })}>
                <option value="">All entities</option>
                {entities.map((o) => (
                  <option key={o.id} value={o.id}>
                    {optionLabel(o)}
                  </option>
                ))}
              </Select>
            </Field>
            {periodMode === "period_id" ? (
              <Field label="Period" className="min-w-[11rem]">
                <Select value={draft.period_id} onChange={(e) => setDraft({ ...draft, period_id: e.target.value })}>
                  <option value="">All periods</option>
                  {periodOptions.map((p) => (
                    <option key={p.period_id} value={p.period_id}>
                      {p.code}
                      {p.status ? ` (${String(p.status).toLowerCase()})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Period code" hint="YYYY or YYYY-MM" className="w-32">
                <Input value={draft.period_code} onChange={(e) => setDraft({ ...draft, period_code: e.target.value })} placeholder="2026-06" />
              </Field>
            )}
            <Field label="From" className="w-40">
              <Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            </Field>
            <Field label="To" className="w-40">
              <Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </Field>
            <div className="flex gap-2">
              <Button onClick={() => setParams(draft)} loading={loading}>
                Apply
              </Button>
              {(params.entity_id || params.period_code || params.period_id || params.from || params.to) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setDraft(EMPTY_PARAMS);
                    setParams(EMPTY_PARAMS);
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          {error ? <ErrorState message={error} /> : loading ? <SkeletonTable /> : <Report data={data} />}
        </>
      )}
    </section>
  );
}
