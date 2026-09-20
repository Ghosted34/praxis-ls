/**
 * Chart (MOD-76 Budget Reconciliation PR 3, owner decision Q15) — the kit's
 * chart library wrapper. Recharts was chosen because it renders **SVG**, so a
 * series colour is a CSS custom property and a tenant's brand re-tints the
 * charts natively; Chart.js / ECharts / uPlot render to canvas, where
 * `var(--primary)` is unreachable and colour would need a second source of
 * truth — exactly what `check:palette` exists to prevent.
 *
 * ─── THE TWO RULES THIS FILE EXISTS TO ENFORCE ──────────────────────────────
 *
 * 1. **No screen imports `recharts` directly.** Everything recharts lives in
 *    `./chart-impl`, which this file loads lazily: a screen that only draws a
 *    `<ConsumptionTrack>` (no library) never downloads a d3 package, and a
 *    screen that charts pays for it only once a chart actually mounts. The
 *    packages sit in `ROUTE_LOCAL_VENDOR` (vite.config.ts) for the same reason
 *    — Rollup attaches them to the lazy chunk, never to `vendor`.
 *
 * 2. **No chart prop ever takes a hex literal.** Series colour comes from
 *    `SERIES`, which the same CSS custom properties `MeterGroup` rides on.
 *    `check:palette` scans text for Tailwind utilities and cannot see a raw
 *    hex in a JS prop, so it has a scoped rule for exactly this file set
 *    (see client/scripts/check-palette.mjs, "CHART FILE RULES").
 *
 * `MeterGroup` stays the right tool for three labelled magnitudes — it costs
 * no bundle. These charts are for the shapes it cannot draw: grouped series,
 * a waterfall, accumulation against a budget over time.
 */
import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

/* ─── Series colour: tokens, never literals ─────────────────────────────── */

/**
 * The ONLY colour vocabulary a chart may use. Values are CSS custom-property
 * references, not literals:
 *
 *   accent   the tenant's brand fill (--primary) — the headline series.
 *   neutral  context — a budget, a benchmark. Muted, because it is the thing
 *            the real series is read AGAINST.
 *   ok/bad/warn  genuine STATE (under budget vs overspent), always beside a
 *            label and a signed number — never colour alone. The `-fill`
 *            variants because these colour SHAPES, not type (--ok itself is
 *            the type-safe ink; a filled bar wants the stronger fill).
 *
 * --primary / --muted-foreground are complete `rgb()` values already;
 * --ok-fill & friends are channel triplets needing an rgb() wrapper — the
 * same convention components/ui/meter.tsx encodes in its FILL map.
 */
export const SERIES = {
  accent: "var(--primary)",
  neutral: "rgb(var(--muted-foreground) / 0.45)",
  ok: "rgb(var(--ok-fill))",
  bad: "rgb(var(--bad-fill))",
  warn: "rgb(var(--warn-fill))",
} as const;

export type SeriesTone = keyof typeof SERIES;

/** Axis/label ink — also tokens. Not in SERIES because text is never a series. */
export const CHART_INK = {
  axis: "var(--muted-foreground)",
  grid: "rgb(var(--muted-foreground) / 0.18)",
  cursor: "rgb(var(--muted-foreground) / 0.12)",
} as const;

/* ─── The shell ─────────────────────────────────────────────────────────── */

/**
 * One chart, announced: a title, an optional description, and a fixed-height
 * region with a single-sentence `aria-label` — the chart's alt text, because
 * an SVG of bars is no more self-explanatory to a screen reader than a
 * `<canvas>` is. Every rendered chart carries its labels and figures in text
 * alongside, so identity never rides on colour alone.
 *
 * The fallback is what renders while `./chart-impl` (and thereby recharts)
 * loads — on a first open this is the skeleton a user sees for a few hundred
 * milliseconds rather than a layout hole.
 */
export function Chart({
  title,
  description,
  ariaLabel,
  height = 240,
  children,
  className,
  titleAs: Title = "h4",
}: {
  title: string;
  description?: string;
  /** One sentence naming what the chart shows. Required, not optional. */
  ariaLabel: string;
  /**
   * The heading level of the chart's own title.
   *
   * `h4` by default, which is right for the common case — a chart inside a
   * `<Panel>` (`h2`) inside a section that already has an `h3`. A chart sitting
   * DIRECTLY in a panel skips a level at `h4`, and axe is correct to call that
   * out: a screen-reader user navigating by heading hears a level that implies
   * a subsection that does not exist. The level is a property of where the
   * chart sits, so the caller states it; the default keeps every existing call
   * site rendering exactly what it rendered before.
   */
  titleAs?: "h3" | "h4" | "h5";
  height?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn("space-y-2", className)}>
      <div>
        <Title className="text-sm font-medium text-foreground">{title}</Title>
        {description && <p className="micro">{description}</p>}
      </div>
      <div role="img" aria-label={ariaLabel} style={{ height }} className="w-full min-w-0">
        {children}
      </div>
    </figure>
  );
}

/** What a lazily-mounted chart shows while recharts parses. */
export function ChartFallback({ height = 240 }: { height?: number }) {
  return (
    <div style={{ height }} className="w-full">
      <Skeleton className="h-full w-full rounded-md" />
    </div>
  );
}

/* ─── The consumption track (no library — one track, three magnitudes) ──── */

/**
 * The ONE visual on the sheet (owner decision Q15: "We should probably have
 * just one visual then a button to view full visuals… To avoid too much
 * congestion."). Budget is the denominator; the track answers one glance with
 * "how much of it is gone":
 *
 *   ▓▓▓▓▓▓▓▓▓▓▓▓▒▒░░░░░─────▕r
 *   └ actual    └ disbused └ remaining budget └ overrun, drawn PAST the end
 *
 * - **Actual** fills from the left in `ok` while it fits the budget.
 * - **Disbursed** underlays it in accent at half strength — the fringe between
 *   the two is cash that has gone out the door and not yet been accounted for.
 * - **Overrun** (actual > budget) extends BEYOND the budget edge in `bad`,
 *   with the budget edge marked, so "we spent 112% of it" is a length, not a
 *   percentage.
 *
 * Hand-drawn, like MeterGroup: a stacked strip of divs is not a plotting
 * problem, and drawing it by hand costs no library. Hover/focus on a segment
 * for its figure (the tooltip is supplementary — every magnitude is printed
 * alongside in the KPI strip this sits under).
 */
export function ConsumptionTrack({
  budget,
  disbursed,
  actual,
  labels,
  values,
  className,
}: {
  budget: number;
  disbursed: number;
  actual: number;
  /** The WORDS — "Budget", "Disbursed", "Actual" — localised by the caller. */
  labels: { budget: string; disbursed: string; actual: string };
  /** The preformatted FIGURES for the tooltips, legend and aria label — the
   *  track never formats money (formats are the format helper's job). */
  values: { budget: string; disbursed: string; actual: string };
  className?: string;
}) {
  const b = Math.max(0, Number(budget) || 0);
  const d = Math.max(0, Number(disbursed) || 0);
  const a = Math.max(0, Number(actual) || 0);
  // The span the row represents: the WIDEST of the three, so an overrun has
  // somewhere to be drawn (a scale capped at budget could never show one).
  const span = Math.max(b, d, a, 1);
  const pct = (v: number) => `${(Math.max(2, Math.min(100, (v / span) * 100)) || 0).toFixed(2)}%`;
  const over = a > b && b > 0;
  const budgetEdge = (b / span) * 100;
  const gonePct = b > 0 ? Math.round((a / b) * 100) : 0;

  return (
    <div
      className={cn("space-y-2", className)}
      role="img"
      aria-label={`${labels.budget} ${values.budget}. ${labels.disbursed} ${values.disbursed}. ${labels.actual} ${values.actual} — ${gonePct}% of the budget is gone${over ? ", over budget" : ""}.`}
    >
      <div className="relative h-3 w-full">
        {/* The track itself = 100% of the budget *on the row's own scale*. */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-muted"
          style={{ width: `${budgetEdge.toFixed(2)}%` }}
        />
        {/* Disbursed underlay — cash out the door, spent or not. */}
        {d > 0 && (
          <Tooltip content={`${labels.disbursed}: ${values.disbursed}`}>
            <div
              tabIndex={0}
              className="absolute inset-y-0 left-0 rounded-l-full bg-primary/45 transition-[width] duration-300"
              style={{ width: pct(d) }}
            />
          </Tooltip>
        )}
        {/* Actual spend, on top. Over budget turns the whole fill bad, because
            "how much is gone" past 100% is a state, not a bigger ok. */}
        {a > 0 && (
          <Tooltip content={`${labels.actual}: ${values.actual}`}>
            <div
              tabIndex={0}
              className={cn(
                "absolute inset-y-0 left-0 rounded-l-full transition-[width] duration-300",
                over ? "bg-[rgb(var(--bad-fill))]" : "bg-[rgb(var(--ok-fill))]",
              )}
              style={{ width: pct(a) }}
            />
          </Tooltip>
        )}
        {/* The budget edge, marked: everything right of this is past budget. */}
        {over && (
          <div
            aria-hidden
            className="absolute inset-y-[-3px] w-px bg-foreground/50"
            style={{ left: `${budgetEdge.toFixed(2)}%` }}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <TrackLegend tone={over ? "bad" : "ok"} label={`${labels.actual} · ${values.actual}`} />
        <TrackLegend tone="accent" label={`${labels.disbursed} · ${values.disbursed}`} />
        <TrackLegend tone="neutral" label={`${labels.budget} · ${values.budget}`} />
        <span className={cn("num micro ml-auto tabular-nums", over ? "text-[rgb(var(--bad))]" : "text-muted-foreground")}>
          {b > 0 ? (over ? `${gonePct}% — over budget` : `${gonePct}% gone`) : "—"}
        </span>
      </div>
    </div>
  );
}

/** legend swatch — a FILL token beside its label; text keeps text tokens. */
function TrackLegend({ tone, label }: { tone: SeriesTone; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          tone === "accent"
            ? "bg-primary/45"
            : tone === "ok"
              ? "bg-[rgb(var(--ok-fill))]"
              : tone === "bad"
                ? "bg-[rgb(var(--bad-fill))]"
                : tone === "warn"
                  ? "bg-[rgb(var(--warn-fill))]"
                  : "bg-muted-foreground/45",
        )}
      />
      <span className="micro">{label}</span>
    </span>
  );
}

/* ─── The library-backed charts, lazily mounted ─────────────────────────── */

/**
 * `./chart-impl` is the ONLY module in the tree that imports `recharts`.
 * Everything below is its public face: each chart a component with plain,
 * hex-free props. React.lazy + Suspense is what makes the lazy loading real —
 * until one of these actually mounts, no d3 package is parsed (checked by
 * `npm run check:bundle` after a build).
 */
const ImplBars = React.lazy(() =>
  import("./chart-impl").then((m) => ({ default: m.SeriesBarsChart })),
);
const ImplWaterfall = React.lazy(() =>
  import("./chart-impl").then((m) => ({ default: m.WaterfallChart })),
);
const ImplTrend = React.lazy(() =>
  import("./chart-impl").then((m) => ({ default: m.TrendChart })),
);

/* — Grouped bars — one cluster per label, one bar per series (spend by line).
     A point may override a series' tone (an over-budget line's actual wears
     bad); tones still come from SERIES, so it costs no new vocabulary. — */
export type BarsPoint = {
  label: string;
  values: Record<string, number>;
  tones?: Record<string, SeriesTone>;
};
export type BarsSeries = { key: string; tone: SeriesTone; label: string };

export function SeriesBars({
  data,
  series,
  height,
  formatValue,
  onPointClick,
  selectedLabel,
}: {
  data: BarsPoint[];
  series: BarsSeries[];
  height?: number;
  formatValue?: (v: number) => string;
  /** Optional direct manipulation for charts whose bars reveal detail. Always
   *  pair it with labelled controls outside the SVG for keyboard access. */
  onPointClick?: (point: BarsPoint, index: number) => void;
  /** Keeps the selected cluster strong while de-emphasising its neighbours. */
  selectedLabel?: string | null;
}) {
  return (
    <React.Suspense fallback={<ChartFallback height={height} />}>
      <ImplBars
        data={data}
        series={series}
        height={height}
        formatValue={formatValue}
        onPointClick={onPointClick}
        selectedLabel={selectedLabel}
      />
    </React.Suspense>
  );
}

/* — The variance waterfall: a starting total, signed steps, a closing total.
     `value` is absolute for kind "total" and signed for kind "delta". — */
export type WaterfallPoint = { label: string; kind: "total" | "delta"; value: number };

export function Waterfall({
  data,
  height,
  formatValue,
  seriesTone,
  legendLabels,
}: {
  data: WaterfallPoint[];
  height?: number;
  formatValue?: (v: number) => string;
  seriesTone?: { positive?: SeriesTone; negative?: SeriesTone; total?: SeriesTone };
  /** What the legend NAMES the directions — sign meaning is domain-specific
   *  (an over-budget variance is a positive delta in one waterfall and its
   *  opposite in another), so the labels are the caller's to declare, never
   *  invented by the component. Default: "Up" / "Down" / "Totals". */
  legendLabels?: { positive?: string; negative?: string; total?: string };
}) {
  return (
    <React.Suspense fallback={<ChartFallback height={height} />}>
      <ImplWaterfall data={data} height={height} formatValue={formatValue} seriesTone={seriesTone} legendLabels={legendLabels} />
    </React.Suspense>
  );
}

/* — Accumulation against a benchmark over time (spend against budget over
     the file's life, possible only since PR 2 dated cost_entry.spent_on). — */
export type TrendPoint = { label: string; value: number; benchmark?: number };

export function Trend({
  data,
  height,
  formatValue,
  valueLabel,
  benchmarkLabel,
}: {
  data: TrendPoint[];
  height?: number;
  formatValue?: (v: number) => string;
  valueLabel?: string;
  benchmarkLabel?: string;
}) {
  return (
    <React.Suspense fallback={<ChartFallback height={height} />}>
      <ImplTrend
        data={data}
        height={height}
        formatValue={formatValue}
        valueLabel={valueLabel}
        benchmarkLabel={benchmarkLabel}
      />
    </React.Suspense>
  );
}
