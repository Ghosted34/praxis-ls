/**
 * The recharts-backed chart implementations — the ONLY module in the tree
 * that imports `recharts` (the screen-facing wrapper is `chart.tsx`, which
 * loads this lazily). Loaded on demand, attached to the lazy route chunk by
 * `ROUTE_LOCAL_VENDOR` (vite.config.ts): nobody who never opens a chart pays
 * for a d3 package.
 *
 * Colour discipline: nothing in here takes a literal. Every fill/stroke is a
 * `SERIES` / `CHART_INK` token from `chart.tsx`, which resolves to a CSS
 * custom property — so a tenant's brand re-tints the charts the same instant
 * it re-tints the buttons. `check:palette`'s scoped chart-file rule is the
 * gate that keeps it that way (a JS prop is invisible to its Tailwind scan;
 * the hex rule is not).
 */
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_INK, SERIES, type BarsPoint, type BarsSeries, type SeriesTone, type TrendPoint, type WaterfallPoint } from "@/components/ui/chart";
import { useIsCompact } from "@/lib/use-media-query";

/* ─── shared bits ───────────────────────────────────────────────────────── */

const AXIS_TICK = { fill: CHART_INK.axis, fontSize: 11 } as const;

/** An axis label a person can read — long line names truncate, the tooltip
 *  still carries the full one. */
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 13)}…` : s);

/**
 * The themed tooltip. Recharts' default is a white box with its own palette —
 * one canvas of colour that would ignore dark mode and every tenant brand.
 * Classnames stay on surface/ink tokens; the per-series dot is a SERIES fill.
 */
function ChartTip({
  active,
  payload,
  label,
  formatValue,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; payload?: Record<string, unknown> }>;
  label?: string;
  formatValue?: (v: number) => string;
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-sm shadow-[var(--shadow-m)]">
      {label && <div className="mb-1 text-micro uppercase text-muted-foreground">{label}</div>}
      <ul className="space-y-0.5">
        {payload.map((p, i) => {
          const v = typeof p.value === "number" ? p.value : Number(p.value) || 0;
          return (
            <li key={i} className="num flex items-center gap-2 tabular-nums text-foreground">
              <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
              <span className="text-muted-foreground">{p.name}</span>
              <span className="ml-auto pl-3 font-medium">{formatValue ? formatValue(v) : v}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The text legend — every bar carries its name in ink, so no series identity
 *  is ever carried by colour alone (same rule the ConsumptionTrack obeys). */
function ChartLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-hidden>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: it.color }} />
          <span className="micro">{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

const fmt = (formatValue?: (v: number) => string) => (v: number) =>
  formatValue ? formatValue(v) : String(v);

/* ─── grouped bars (spend by line) ──────────────────────────────────────── */

export function SeriesBarsChart({
  data,
  series,
  height = 240,
  formatValue,
  onPointClick,
  selectedLabel,
}: {
  data: BarsPoint[];
  series: BarsSeries[];
  height?: number;
  formatValue?: (v: number) => string;
  onPointClick?: (point: BarsPoint, index: number) => void;
  selectedLabel?: string | null;
}) {
  const compact = useIsCompact();
  const crowdedAxis = compact && data.length >= 4 && data.length <= 8;
  const rows = data.map((p) => ({ ...p, label: p.label }));
  return (
    <div
      className="flex h-full min-w-0 max-w-full flex-col overflow-hidden"
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tickFormatter={short}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            // Four to eight categories fit a phone only when every label is
            // angled into its own lane. Larger series keep Recharts' sampling
            // rather than painting thirty unreadable dates on top of each other.
            interval={crowdedAxis ? 0 : "preserveStartEnd"}
            angle={crowdedAxis ? -35 : 0}
            textAnchor={crowdedAxis ? "end" : "middle"}
            height={crowdedAxis ? 58 : 30}
          />
          <YAxis
            tickFormatter={fmt(formatValue)}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            // Counts need little room on a phone; formatted money keeps the
            // wider gutter used by reconciliation charts.
            width={formatValue ? 84 : 48}
          />
          <RTooltip
            cursor={{ fill: CHART_INK.cursor }}
            content={<ChartTip formatValue={formatValue} />}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              name={s.label}
              dataKey={(p: BarsPoint) => p.values[s.key] ?? 0}
              fill={SERIES[s.tone]}
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
              className={onPointClick ? "cursor-pointer" : undefined}
              onClick={
                onPointClick
                  ? (_entry, index) => {
                      const point = data[index];
                      if (point) onPointClick(point, index);
                    }
                  : undefined
              }
            >
              {rows.map((p, i) => {
                const selected = !selectedLabel || p.label === selectedLabel;
                return (
                  <Cell
                    key={i}
                    fill={SERIES[p.tones?.[s.key] ?? s.tone]}
                    fillOpacity={selected ? 1 : 0.3}
                    stroke={
                      p.label === selectedLabel ? CHART_INK.axis : undefined
                    }
                    strokeWidth={p.label === selectedLabel ? 2 : 0}
                  />
                );
              })}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
      <ChartLegend
        items={series.map((s) => ({ label: s.label, color: SERIES[s.tone] }))}
      />
    </div>
  );
}

/* ─── the variance waterfall ────────────────────────────────────────────── */

/**
 * A starting total (the budget), the signed contribution of each line (its
 * variance), and the closing total — "where did +4% go". Positive deltas
 * (under budget) go up in ok, negative (overspend) down in bad; totals are
 * neutral context. The invisible `base` bar floats each delta to where the
 * running total stood, which is the whole shape of a waterfall.
 */
export function WaterfallChart({
  data,
  height = 240,
  formatValue,
  seriesTone,
  legendLabels,
}: {
  data: WaterfallPoint[];
  height?: number;
  formatValue?: (v: number) => string;
  seriesTone?: { positive?: SeriesTone; negative?: SeriesTone; total?: SeriesTone };
  legendLabels?: { positive?: string; negative?: string; total?: string };
}) {
  const tones = { positive: "ok", negative: "bad", total: "neutral", ...(seriesTone || {}) } as {
    positive: SeriesTone;
    negative: SeriesTone;
    total: SeriesTone;
  };
  let running = 0;
  const rows = data.map((p) => {
    if (p.kind === "total") {
      running = p.value;
      const lo = Math.min(0, p.value);
      return { label: p.label, base: lo, span: Math.abs(p.value), tone: tones.total, shown: p.value };
    }
    const next = running + p.value;
    const lo = Math.min(running, next);
    const row = { label: p.label, base: lo, span: Math.abs(p.value), tone: p.value >= 0 ? tones.positive : tones.negative, shown: p.value };
    running = next;
    return row;
  });
  return (
    <div className="flex h-full flex-col" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
          <XAxis dataKey="label" tickFormatter={short} tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmt(formatValue)} tick={AXIS_TICK} axisLine={false} tickLine={false} width={84} />
          <RTooltip cursor={{ fill: CHART_INK.cursor }} content={<WaterfallTip formatValue={formatValue} />} />
          <ReferenceLine y={0} stroke={CHART_INK.grid} />
          <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="span" stackId="wf" radius={[3, 3, 0, 0]} maxBarSize={36}>
            {rows.map((r, i) => (
              <Cell key={i} fill={SERIES[r.tone]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <ChartLegend
        items={[
          { label: legendLabels?.positive ?? "Up", color: SERIES[tones.positive] },
          { label: legendLabels?.negative ?? "Down", color: SERIES[tones.negative] },
          { label: legendLabels?.total ?? "Totals", color: SERIES[tones.total] },
        ]}
      />
    </div>
  );
}

function WaterfallTip({
  active,
  payload,
  label,
  formatValue,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { shown?: number; tone?: SeriesTone; label?: string } }>;
  label?: string;
  formatValue?: (v: number) => string;
}) {
  if (!active || !payload || !payload.length) return null;
  const row = payload.find((p) => p.payload && typeof p.payload.shown === "number")?.payload;
  if (!row) return null;
  const v = Number(row.shown) || 0;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-sm shadow-[var(--shadow-m)]">
      <div className="mb-1 text-micro uppercase text-muted-foreground">{label}</div>
      <div className="num flex items-center gap-2 tabular-nums text-foreground">
        {row.tone && <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES[row.tone] }} />}
        <span className="font-medium">{v > 0 ? "+" : ""}{formatValue ? formatValue(v) : v}</span>
      </div>
    </div>
  );
}

/* ─── accumulation against a benchmark (spend over the file's life) ─────── */

export function TrendChart({
  data,
  height = 240,
  formatValue,
  valueLabel = "Cumulative",
  benchmarkLabel = "Budget",
}: {
  data: TrendPoint[];
  height?: number;
  formatValue?: (v: number) => string;
  valueLabel?: string;
  benchmarkLabel?: string;
}) {
  const hasBenchmark = data.some((p) => p.benchmark !== undefined && p.benchmark !== null);
  return (
    <div className="flex h-full flex-col" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmt(formatValue)} tick={AXIS_TICK} axisLine={false} tickLine={false} width={84} />
          <RTooltip cursor={{ fill: CHART_INK.cursor }} content={<ChartTip formatValue={formatValue} />} />
          <Area
            name={valueLabel}
            type="monotone"
            dataKey="value"
            stroke={SERIES.accent}
            fill={SERIES.accent}
            fillOpacity={0.18}
            strokeWidth={2}
          />
          {hasBenchmark && (
            <Line
              name={benchmarkLabel}
              type="monotone"
              dataKey="benchmark"
              stroke={SERIES.neutral}
              strokeDasharray="5 4"
              strokeWidth={2}
              dot={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <ChartLegend
        items={[
          { label: valueLabel, color: SERIES.accent },
          ...(hasBenchmark ? [{ label: benchmarkLabel, color: SERIES.neutral }] : []),
        ]}
      />
    </div>
  );
}
