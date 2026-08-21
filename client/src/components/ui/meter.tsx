/**
 * Meter — a labelled magnitude bar, and a group of them sharing one scale.
 *
 * The seventh copy problem, avoided: `finance/hub.tsx`'s `AgeingPanel` already
 * draws this shape by hand, and the Lovable mock's `.age/.ager` block is the
 * same idiom (label · track · figure). Commercial needs it twice more —
 * Profitability Snapshot and Budget-vs-Actual — so it lands in the kit rather
 * than as copies three and four.
 *
 * WHY BARS, AND WHY NOT A CHART LIBRARY
 *
 * The job is magnitude comparison across a handful of named quantities. That is
 * a bar chart, and at three-to-five bars it is a few divs — a plotting library
 * would add a bundle, a canvas, and a second set of colours competing with the
 * brand accent, to draw rectangles. Every bar is directly labelled with its name
 * and its value, so identity is never carried by colour alone and no legend box
 * is needed.
 *
 * COLOUR IS ASSIGNED BY JOB, NOT BY POSITION
 *
 *   "neutral"  a magnitude that is neither good nor bad — a cost, a budget.
 *              Muted ink; it is context for the bar that matters.
 *   "accent"   the brand figure — revenue, the thing being earned. `--primary`,
 *              so it re-tints when a tenant changes its brand (FE conventions:
 *              the accent is settings-driven and must dominate).
 *   "ok"/"bad" reserved for genuine STATE — is the net positive, did the budget
 *              hold. These ship beside a text label and a signed number, never
 *              as colour alone.
 *
 * Deliberately NOT offered: an arbitrary categorical palette. Nothing here has
 * more than a few bars with fixed meanings, and a cycled hue set would compete
 * with `--primary` for exactly no gain.
 *
 * SCALE. One shared denominator across the group — `max` if given, otherwise the
 * largest absolute value present. Bars are drawn from their absolute value so a
 * negative net still has length; its sign lives in the tone and the number.
 *
 * @example
 * <MeterGroup
 *   ariaLabel="Cost, revenue and net for this simulation"
 *   rows={[
 *     { label: "Cost",    value: 95_700_000, display: money(95_700_000), tone: "neutral" },
 *     { label: "Revenue", value: 0,          display: money(0),          tone: "accent" },
 *     { label: "Net",     value: -95_700_000, display: money(-95_700_000), tone: "bad" },
 *   ]}
 * />
 */
import * as React from "react";
import { cn } from "@/lib/cn";

export type MeterTone = "neutral" | "accent" | "ok" | "bad" | "warn";

/** Fills only. Text alongside keeps text tokens — a value never wears the
 *  series colour (it would fail contrast the moment a tenant picks a pale
 *  brand, and `Stat` already learned that: --primary-ink for ink, --primary
 *  for fills). */
const FILL: Record<MeterTone, string> = {
  neutral: "bg-muted-foreground/45",
  accent: "bg-primary",
  ok: "bg-[rgb(var(--ok))]",
  bad: "bg-[rgb(var(--bad))]",
  warn: "bg-[rgb(var(--warn))]",
};

export type MeterRow = {
  label: string;
  /** The magnitude. May be negative; length uses its absolute value. */
  value: number;
  /** Preformatted figure (pass money() / percent) — the bar never formats. */
  display: React.ReactNode;
  tone?: MeterTone;
  /** Optional qualifier under the label, e.g. "40 × 2,000,000". */
  hint?: string;
};

export function MeterGroup({
  rows,
  max,
  ariaLabel,
  className,
}: {
  rows: MeterRow[];
  /** Shared denominator. Defaults to the largest absolute value in `rows`. */
  max?: number;
  /** One sentence naming what the group shows — this is the chart's alt text. */
  ariaLabel: string;
  className?: string;
}) {
  const denominator = React.useMemo(() => {
    const given = Number(max);
    if (Number.isFinite(given) && given > 0) return given;
    const largest = Math.max(...rows.map((r) => Math.abs(Number(r.value) || 0)), 0);
    return largest > 0 ? largest : 1;
  }, [rows, max]);

  return (
    <div className={cn("space-y-2", className)} role="img" aria-label={ariaLabel}>
      {rows.map((r) => {
        const magnitude = Math.abs(Number(r.value) || 0);
        // A non-zero quantity always shows SOME bar: rounding a real 0.3% to
        // nothing reads as "no cost at all", which is a different claim.
        const pct = magnitude === 0 ? 0 : Math.max(2, Math.min(100, (magnitude / denominator) * 100));
        return (
          <div key={r.label} className="flex items-center gap-3">
            <div className="w-28 shrink-0">
              <div className="text-micro uppercase text-muted-foreground">{r.label}</div>
              {r.hint && <div className="text-micro text-muted-foreground/70">{r.hint}</div>}
            </div>
            {/* h-2 keeps the mark thin; rounded-full gives the 4px data-end.
                The track is a surface, not a series colour. */}
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-[width] duration-300", FILL[r.tone || "neutral"])}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="num w-36 shrink-0 text-right text-sm font-medium tabular-nums">
              {r.display}
            </div>
          </div>
        );
      })}
    </div>
  );
}
