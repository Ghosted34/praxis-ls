/**
 * Financial dictionary 360 — the two money tabs.
 *
 *   Spend             what this line cost us over a period, through three lenses
 *   Cost & evolution  how its rate has moved, on the effective-dated history
 *
 * WHY THREE LENSES AND NOT ONE NUMBER. "How much does this line cost us?" has
 * three honest answers and they belong to different people: the planner's
 * (what a costing sheet estimated), the treasurer's (what has been committed to
 * a third party on an open PO or an approved cash request), and the
 * accountant's (what the ledger says was posted). The headline is ACTUAL,
 * because it is the only one that has happened; the gap to COMMITTED is the
 * useful signal — money promised and not yet posted is either work in flight or
 * a document nobody closed.
 *
 * THE CHART IS INLINE SVG, no chart library. It is a grouped bar per month with
 * a value axis, which is the whole requirement, and every colour is a theme
 * token (`rgb(var(--…))`) so it is correct in both themes without a second
 * palette. The precedent is the Sparkline in settings/currencies.tsx.
 *
 * ACCESSIBILITY. The chart is `role="img"` with a full `aria-label` summarising
 * the period, and the same numbers are ALSO in the month table below it — the
 * table is the accessible version of the chart, not a duplicate. Panels are
 * <h3> under the dossier's <h2> (heading-order, WCAG 1.3.1).
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Callout } from "@/components/ui/callout";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { useResource } from "@/lib/use-resource";
import { money, num, dateFmt } from "@/lib/format";
import * as api from "@/lib/masterdata-api";

/* ── Period picker ────────────────────────────────────────────────────────── */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const startOfMonth = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/**
 * The presets an operator actually asks for, resolved to concrete days here so
 * the request is always explicit. "Custom" hands the two dates to the user.
 */
export type PeriodPreset = "month" | "quarter" | "year" | "custom";
const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "12 months" },
  { value: "custom", label: "Custom" },
];

function presetRange(
  preset: PeriodPreset,
  today = new Date(),
): { from: string; to: string } {
  const to = iso(today);
  if (preset === "month") return { from: iso(startOfMonth(today)), to };
  if (preset === "quarter") {
    const q = Math.floor(today.getUTCMonth() / 3) * 3;
    return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), q, 1))), to };
  }
  // 12 months = 11 back + the 1st, so the current month is the twelfth.
  return {
    from: iso(
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1)),
    ),
    to,
  };
}

function PeriodPicker({
  preset,
  from,
  to,
  onPreset,
  onFrom,
  onTo,
}: {
  preset: PeriodPreset;
  from: string;
  to: string;
  onPreset: (p: PeriodPreset) => void;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label={tr("Period")}
        value={preset}
        onChange={(v) => onPreset(v as PeriodPreset)}
        options={PRESETS}
      />
      {preset === "custom" && (
        <>
          <Input
            type="date"
            aria-label="Period from"
            value={from}
            onChange={(e) => onFrom(e.target.value)}
            className="w-40"
          />
          <span className="micro">to</span>
          <Input
            type="date"
            aria-label="Period to"
            value={to}
            onChange={(e) => onTo(e.target.value)}
            className="w-40"
          />
        </>
      )}
      {preset !== "custom" && (
        <span className="micro">
          {dateFmt(from)} — {dateFmt(to)}
        </span>
      )}
    </div>
  );
}

/* ── The grouped bar chart ────────────────────────────────────────────────── */

const LENSES: { key: api.SpendLens; label: string; stroke: string }[] = [
  {
    key: "estimated",
    label: "Estimated",
    stroke: "rgb(var(--muted-foreground))",
  },
  { key: "committed", label: "Committed", stroke: "rgb(var(--warn))" },
  { key: "actual", label: "Actual", stroke: "rgb(var(--primary))" },
];

/**
 * Grouped bars, one group per month, three bars per group.
 *
 * Bars rather than lines because the months are discrete buckets, not samples
 * of a continuous quantity — a line implies a value between March and April and
 * there isn't one. Widths are computed from the month count so twelve months
 * and three months both fill the frame.
 */
function SpendChart({
  months,
  currency,
}: {
  months: api.SpendMonth[];
  currency: string;
}) {
  const w = 720;
  const h = 200;
  const padL = 8;
  const padB = 26;
  const padT = 10;
  const max = Math.max(
    1,
    ...months.flatMap((m) => [m.estimated, m.committed, m.actual]),
  );
  const plotH = h - padB - padT;
  const groupW = (w - padL * 2) / Math.max(months.length, 1);
  const barW = Math.max(2, Math.min(14, (groupW - 6) / 3));

  const label =
    `Spend by month, ${currency}. ` +
    months
      .map(
        (m) =>
          `${m.month}: actual ${Math.round(m.actual)}, committed ${Math.round(m.committed)}, estimated ${Math.round(m.estimated)}`,
      )
      .join("; ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      {/* Baseline + a single mid gridline: two references are enough to read a
          bar against, and more would crowd a 200px frame. */}
      <line
        x1={padL}
        y1={padT + plotH}
        x2={w - padL}
        y2={padT + plotH}
        stroke="rgb(var(--border))"
        strokeWidth="1"
      />
      <line
        x1={padL}
        y1={padT + plotH / 2}
        x2={w - padL}
        y2={padT + plotH / 2}
        stroke="rgb(var(--border))"
        strokeWidth="0.5"
        strokeDasharray="3 3"
      />
      {months.map((m, i) => {
        const gx = padL + i * groupW;
        return (
          <g key={m.month}>
            {LENSES.map((lens, j) => {
              const v = m[lens.key];
              const barH = max === 0 ? 0 : (v / max) * plotH;
              return (
                <rect
                  key={lens.key}
                  x={gx + (groupW - barW * 3 - 4) / 2 + j * (barW + 2)}
                  y={padT + plotH - barH}
                  width={barW}
                  height={Math.max(barH, v > 0 ? 1 : 0)}
                  fill={lens.stroke}
                  opacity={lens.key === "actual" ? 1 : 0.55}
                  rx="1"
                />
              );
            })}
            {/* Every other label when the axis is crowded, so they never overlap. */}
            {(months.length <= 8 || i % 2 === 0) && (
              <text
                x={gx + groupW / 2}
                y={h - 8}
                textAnchor="middle"
                fontSize="9"
                fill="rgb(var(--muted-foreground))"
              >
                {m.month.slice(2)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {LENSES.map((l) => (
        <li key={l.key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{
              background: l.stroke,
              opacity: l.key === "actual" ? 1 : 0.55,
            }}
          />
          {l.label}
        </li>
      ))}
    </ul>
  );
}

/* ── Spend tab ────────────────────────────────────────────────────────────── */

/**
 * Deep-link + label per document type — `Map`s, not object literals, and looked
 * up with an explicit fallback.
 *
 * `doc_type` arrives from the server, and TypeScript's union type is a
 * compile-time claim about it, not a runtime guarantee. Two things follow from
 * indexing a plain object with it:
 *
 *   - a value outside the four keys yields `undefined`, and `DOC_ROUTE[t](doc)`
 *     then throws "is not a function", taking down the whole tab over one
 *     unrecognised row — a new document type added server-side would do it;
 *   - the lookup walks the prototype chain, so `doc_type: "constructor"`
 *     resolves to `Object` and CALLS it. That is the dynamic-method-call class
 *     CodeQL's security-extended pack flags, and it is a real hole rather than
 *     a theoretical one: this value crosses a trust boundary.
 *
 * A `Map` has no prototype chain to walk into, and `?? fallback` degrades an
 * unknown type to an inert link instead of an exception.
 */
const DOC_ROUTE = new Map<string, (d: api.SpendDocument) => string>([
  ["costing", (d) => `/costing/sheets?focus=${d.doc_id}`],
  ["purchase_order", (d) => `/procurement/purchase-orders?focus=${d.doc_id}`],
  ["cash_request", (d) => `/costing/cash-requests?focus=${d.doc_id}`],
  [
    "cost_entry",
    (d) =>
      d.dossier_id
        ? `/operations/files?focus=${d.dossier_id}`
        : "/costing/cost-tracking",
  ],
]);
const DOC_LABEL = new Map<string, string>([
  ["costing", "Costing"],
  ["purchase_order", "Purchase order"],
  ["cash_request", "Cash request"],
  ["cost_entry", "Cost entry"],
]);
/** Where a drill-in row points. An unknown type gets no link target, not a crash. */
const docHref = (d: api.SpendDocument) =>
  DOC_ROUTE.get(String(d.doc_type))?.(d);
const docLabel = (d: api.SpendDocument) =>
  DOC_LABEL.get(String(d.doc_type)) ?? "Document";

export function SpendTab({ id }: { id: string }) {
  const [preset, setPreset] = React.useState<PeriodPreset>("year");
  const [range, setRange] = React.useState(() => presetRange("year"));
  const [lensFilter, setLensFilter] = React.useState<"" | api.SpendLens>("");

  // A preset writes concrete dates so the request is always explicit; custom
  // leaves whatever the user typed alone.
  const choosePreset = (p: PeriodPreset) => {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
  };

  const spend = useResource(
    () => api.dictSpend(id, { from: range.from, to: range.to }),
    [id, range.from, range.to],
  );

  if (spend.loading) return <LoadingRow label="Loading spend…" />;
  if (spend.error) return <ErrorState message={spend.error} />;
  if (!spend.data)
    return (
      <EmptyState
        title="No spend data"
        hint="This item has not been used on a document yet."
      />
    );

  const d = spend.data;
  const cur = d.item.currency || "XAF";
  const docs = lensFilter
    ? d.documents.filter((x) => x.lens === lensFilter)
    : d.documents;
  const nothing =
    d.totals.estimated === 0 &&
    d.totals.committed === 0 &&
    d.totals.actual === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker
          preset={preset}
          from={range.from}
          to={range.to}
          onPreset={choosePreset}
          onFrom={(v) => {
            setPreset("custom");
            setRange((r) => ({ ...r, from: v }));
          }}
          onTo={(v) => {
            setPreset("custom");
            setRange((r) => ({ ...r, to: v }));
          }}
        />
        <Legend />
      </div>

      {/* Headline = actual. The other two tiles are context for it, which is why
          the variance is stated on the committed tile rather than as a fourth. */}
      <KpiRow>
        <KpiTile
          label={`Actual (${cur})`}
          value={money(d.totals.actual, cur)}
          hint={`${num(d.totals.actual_count)} ledger entries`}
        />
        <KpiTile
          label={tr("Committed")}
          value={money(d.totals.committed, cur)}
          hint={`${money(d.totals.variance_committed_actual, cur)} not yet posted`}
        />
        <KpiTile
          label={tr("Estimated")}
          value={money(d.totals.estimated, cur)}
          hint={`${num(d.totals.estimated_count)} costing lines`}
        />
        <KpiTile
          label={tr("Documents")}
          value={num(d.documents.length)}
          hint={`${dateFmt(d.period.from)} — ${dateFmt(d.period.to)}`}
        />
      </KpiRow>

      {nothing ? (
        <EmptyState
          title="No spend in this period"
          hint="Widen the period, or this line has not been costed, ordered or posted yet."
        />
      ) : (
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            By month
          </h3>
          <SpendChart months={d.months} currency={cur} />
          <div className="mt-3 max-h-56 overflow-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Spend per month for {d.item.code}, in {cur}
              </caption>
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th scope="col" className="px-3 py-2">
                    Month
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Estimated
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Committed
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Actual
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.months.map((m) => (
                  <tr
                    key={m.month}
                    className={
                      m.actual === 0 && m.committed === 0 && m.estimated === 0
                        ? "text-muted-foreground"
                        : ""
                    }
                  >
                    <td className="px-3 py-1.5 num text-xs">{m.month}</td>
                    <td className="px-3 py-1.5 num text-right text-xs">
                      {money(m.estimated, cur)}
                    </td>
                    <td className="px-3 py-1.5 num text-right text-xs">
                      {money(m.committed, cur)}
                    </td>
                    <td className="px-3 py-1.5 num text-right text-xs font-semibold text-foreground">
                      {money(m.actual, cur)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Drill-in. Rows deep-link to the module that OWNS the document rather
          than opening a modal here — the convention party-360.tsx documents. */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Underlying documents
          </h3>
          <Segmented
            label="Lens filter"
            value={lensFilter}
            onChange={(v) => setLensFilter(v as "" | api.SpendLens)}
            options={[
              { value: "", label: "All" },
              ...LENSES.map((l) => ({ value: l.key, label: l.label })),
            ]}
          />
        </div>
        {docs.length === 0 ? (
          <p className="micro">
            No documents in this period{lensFilter ? " for this lens" : ""}.
          </p>
        ) : (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Documents behind the spend figures
              </caption>
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th scope="col" className="px-3 py-2">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Document
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Dossier
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {docs.map((doc, i) => {
                  const href = docHref(doc);
                  const name = doc.doc_number || docLabel(doc);
                  return (
                    <tr key={`${doc.doc_type}-${doc.doc_id}-${i}`}>
                      <td className="px-3 py-1.5 num text-xs">
                        {dateFmt(doc.doc_date)}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        {/* Plain text when the type has no known route — an <a>
                          with no href is not a link, and announcing one to a
                          screen reader that goes nowhere is worse than a label. */}
                        {href ? (
                          <a
                            href={href}
                            className="font-medium text-primary-ink underline-offset-2 hover:underline"
                          >
                            {name}
                          </a>
                        ) : (
                          <span className="font-medium">{name}</span>
                        )}
                        {doc.label ? (
                          <span className="block text-muted-foreground">
                            {doc.label}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-1.5 num text-xs">
                        {doc.dossier_ref || "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <Pill
                          tone={
                            doc.lens === "actual"
                              ? "ok"
                              : doc.lens === "committed"
                                ? "warn"
                                : "mute"
                          }
                        >
                          {doc.status || doc.lens}
                        </Pill>
                      </td>
                      <td className="px-3 py-1.5 num text-right text-xs">
                        {money(doc.amount, doc.currency || cur)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Cost & evolution tab ─────────────────────────────────────────────────── */

/** A rate series as a step line — a rate holds until it is superseded, so a
 *  straight interpolation between two effective dates would draw a change that
 *  never happened. Steps are the honest shape for effective-dated data. */
function RateStepLine({
  points,
  currency,
}: {
  points: api.RatePoint[];
  currency: string;
}) {
  const w = 320;
  const h = 56;
  const pad = 4;
  if (points.length < 2) return null;
  const vals = points.map((p) => Number(p.rate));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);

  let dPath = `M ${x(0).toFixed(1)} ${y(vals[0]).toFixed(1)}`;
  for (let i = 1; i < vals.length; i += 1) {
    dPath += ` L ${x(i).toFixed(1)} ${y(vals[i - 1]).toFixed(1)} L ${x(i).toFixed(1)} ${y(vals[i]).toFixed(1)}`;
  }
  const up = vals[vals.length - 1] >= vals[0];
  const label = `Rate history in ${currency}: ${points.map((p) => `${p.effective_from} ${p.rate}`).join(", ")}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full max-w-[320px]"
      role="img"
      aria-label={label}
    >
      <path
        d={dPath}
        fill="none"
        stroke={up ? "rgb(var(--warn))" : "rgb(var(--ok))"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <circle
          key={p.expense_rate_id}
          cx={x(i)}
          cy={y(vals[i])}
          r={p.in_force ? 3 : 1.8}
          fill={
            p.in_force ? "rgb(var(--primary))" : "rgb(var(--muted-foreground))"
          }
        />
      ))}
    </svg>
  );
}

function TrendPill({
  trend,
  currency,
}: {
  trend: api.RateTrend;
  currency: string;
}) {
  if (trend.points < 2) return <Pill tone="mute">No movement yet</Pill>;
  const tone =
    trend.direction === "up"
      ? "warn"
      : trend.direction === "down"
        ? "ok"
        : "mute";
  const arrow =
    trend.direction === "up" ? "▲" : trend.direction === "down" ? "▼" : "▬";
  const pct =
    trend.delta_pct === null
      ? ""
      : ` ${trend.delta_pct > 0 ? "+" : ""}${trend.delta_pct}%`;
  return (
    <Pill tone={tone}>
      {arrow} {money(trend.delta ?? 0, currency)}
      {pct}
    </Pill>
  );
}

export function CostEvolutionTab({ id }: { id: string }) {
  const hist = useResource(() => api.dictRateHistory(id), [id]);

  if (hist.loading) return <LoadingRow label="Loading rate history…" />;
  if (hist.error) return <ErrorState message={hist.error} />;
  if (!hist.data)
    return (
      <EmptyState
        title="No rate history"
        hint="This item has no rate cards yet."
      />
    );

  const d = hist.data;
  if (d.series.length === 0) {
    return (
      <EmptyState
        title="No rate cards"
        hint="Add an expense rate for this line (Master data → Expense rates) and its history will build here as rates are superseded."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Callout tone="info" title="Rates are superseded, never edited">
        Amending a rate expires the open row the day before the new one opens,
        so the history stays continuous and a back-dated document still resolves
        the rate that was really in force. This is the same discipline tax codes
        use.
      </Callout>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Overall movement</span>
        <TrendPill trend={d.trend} currency={d.item.currency} />
        <span className="micro">
          {d.trend.points} rate version{d.trend.points === 1 ? "" : "s"} across{" "}
          {d.series.length} series
        </span>
      </div>

      {d.series.map((s) => (
        <div key={s.key} className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                {s.provider_name ||
                  s.provider_kind?.replace(/_/g, " ").toLowerCase() ||
                  "Standard rate"}
                {s.container_type_code ? (
                  <span className="ml-2 micro">
                    {s.container_type_name || s.container_type_code}
                  </span>
                ) : null}
              </h3>
              <p className="micro">
                {s.current
                  ? `Currently ${money(s.current.rate, s.currency)} since ${dateFmt(s.current.effective_from)}`
                  : "No rate is in force today"}
              </p>
            </div>
            <TrendPill trend={s.trend} currency={s.currency} />
          </div>

          <RateStepLine points={s.points} currency={s.currency} />

          <div className="mt-3 overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Effective-dated rate versions
              </caption>
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th scope="col" className="px-3 py-2">
                    From
                  </th>
                  <th scope="col" className="px-3 py-2">
                    To
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Rate
                  </th>
                  <th scope="col" className="px-3 py-2">
                    State
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Note
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...s.points].reverse().map((p) => (
                  <tr key={p.expense_rate_id}>
                    <td className="px-3 py-1.5 num text-xs">
                      {dateFmt(p.effective_from)}
                    </td>
                    <td className="px-3 py-1.5 num text-xs">
                      {p.effective_to ? dateFmt(p.effective_to) : "—"}
                    </td>
                    <td className="px-3 py-1.5 num text-right text-xs font-semibold">
                      {money(p.rate, p.currency || s.currency)}
                    </td>
                    <td className="px-3 py-1.5">
                      {p.in_force ? (
                        <Pill tone="ok">In force</Pill>
                      ) : p.superseded ? (
                        <Pill tone="mute">Superseded</Pill>
                      ) : (
                        <Pill tone="blue">{tr("Scheduled")}</Pill>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">
                      {p.note || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Exported for the dossier's action bar — a deep link rather than a form here,
 *  because expense rates are MOD-10's to own and this tab is the read. */
export function ManageRatesLink() {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        window.location.href = "/master/expense-rates";
      }}
    >
      Manage rates
    </Button>
  );
}
