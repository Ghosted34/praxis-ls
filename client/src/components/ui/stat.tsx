/**
 * Stat — one labelled figure in a bordered tile.
 *
 * Consolidates FOUR implementations of the same 8-line component (F6 / A3):
 * `features/master/pages.tsx:234`, `features/operations/pages.tsx:188`,
 * `features/fleet/fuel.tsx:21`, and `MetricTile` from `features/sales/ui.tsx:142`
 * (which Sales, Commercial and Settings all imported across feature boundaries).
 * They differed only in padding, in what they called the emphasis prop
 * (`good` / `tone` / `accent`) and in one raw-palette colour.
 *
 * `Stat` vs `KpiTile`: `KpiTile` + `KpiRow` is the slim divided strip that sits
 * above a list screen — four numbers in one row of chrome. `Stat` is a
 * standalone tile for a detail panel or modal, where the figures sit in their
 * own grid and each needs a visible boundary. Do not use `Stat` for a page's
 * headline KPI band; use `KpiRow`.
 *
 * @example
 * <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
 *   <Stat label="Planned cost" value={money(d.planned)} />
 *   <Stat label="Outstanding" value={money(d.outstanding)} tone="warn" />
 * </div>
 *
 * BEST PRACTICE. `tone` carries meaning, not decoration — `ok` means the figure
 * is healthy, `bad` that it needs attention. A grid where every tile is toned
 * communicates nothing, so leave the default on anything neutral. Pass money
 * through `money()` from `lib/format` so the `.num` tabular figures line up
 * across the grid.
 */
import * as React from "react";
import { cn } from "@/lib/cn";

export type StatTone = "default" | "ok" | "warn" | "bad" | "accent";

const TONE: Record<StatTone, string> = {
  default: "text-foreground",
  ok: "text-[rgb(var(--ok))]",
  warn: "text-[rgb(var(--warn))]",
  bad: "text-[rgb(var(--bad))]",
  // --primary-ink, never --primary: this is TEXT, and the raw brand orange
  // measures 2.59:1 against the card (F13).
  accent: "text-primary-ink",
};

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** Optional secondary line under the value (e.g. "vs last month"). */
  hint?: string;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card px-3.5 py-2.5", className)}>
      <div className="text-micro uppercase text-muted-foreground">{label}</div>
      <div className={cn("num mt-0.5 text-title font-semibold", TONE[tone])}>
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-micro text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}
