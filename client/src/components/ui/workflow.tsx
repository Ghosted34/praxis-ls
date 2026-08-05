/**
 * Shared workflow blocks — the three patterns the HR/Fleet/WMS workstations were
 * each hand-rolling inline (per doc/UI_DEPTH_OVERHAUL_PLAN.md "build once, reuse"):
 *
 *   <StepBar/>          — the lifecycle timeline (reached stages filled, current
 *                         highlighted). The visual the depth plan called for.
 *   <StatusActionBar/>  — current status Pill + the available transition buttons.
 *   <LineTable/>        — the bordered line-item grid (WO parts, pick lines,
 *                         count sheets) with loading/empty states.
 *
 * Design-system only — colours resolve to --primary via tokens so tenant
 * re-tinting keeps working.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Pill, type Tone } from "@/components/ui/pill";
import { enumLabel } from "@/lib/format";

type Step = string | { key: string; label: string };

/** Ordered lifecycle stepper. `steps` is the happy path; `current` the live stage. */
export function StepBar({ steps, current }: { steps: Step[]; current: string }) {
  const keys = steps.map((s) => (typeof s === "string" ? s : s.key));
  const idx = keys.indexOf(current);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[11px]">
      {steps.map((s, i) => {
        const key = typeof s === "string" ? s : s.key;
        const label = typeof s === "string" ? enumLabel(s) : s.label;
        const reached = idx >= 0 && i <= idx;
        const isCurrent = i === idx;
        return (
          <React.Fragment key={key}>
            {i > 0 && <span className={cn("h-px w-5", reached ? "bg-primary" : "bg-border")} aria-hidden />}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition-colors",
                isCurrent
                  ? "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary-ink"
                  : reached
                    ? "text-primary-ink"
                    : "text-muted-foreground",
              )}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", reached ? "bg-primary" : "bg-[rgb(var(--ink-3))]")} aria-hidden />
              {label}
            </span>
          </React.Fragment>
        );
      })}
    </ol>
  );
}

export type Transition = { to: string; label: string; variant?: "default" | "outline"; loading?: boolean };

/** The record's available transition buttons — the per-row / detail action group.
 *  Each item carries its own `loading` (callers compute it from whatever busy-key
 *  scheme they use), so this works for both list rows and detail bars. */
export function TransitionButtons({
  items,
  onTransition,
  className,
}: {
  items: Transition[];
  onTransition: (to: string) => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap justify-end gap-2", className)}>
      {items.map((t) => (
        <Button key={t.to} size="sm" variant={t.variant || "default"} loading={t.loading} onClick={() => onTransition(t.to)}>
          {t.label}
        </Button>
      ))}
    </div>
  );
}

/** Status Pill + the record's available transition buttons. `busyKey` is compared
 *  against `"st:" + to` so the clicked button shows a spinner. Left-side `children`
 *  carry any extra context (e.g. a cost readout). */
export function StatusActionBar({
  status,
  tone,
  transitions,
  onTransition,
  busyKey,
  children,
}: {
  status: string;
  tone?: Tone;
  transitions: Transition[];
  onTransition: (to: string) => void;
  busyKey?: string | null;
  children?: React.ReactNode;
}) {
  const items = transitions.map((t) => ({ ...t, loading: busyKey === "st:" + t.to }));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Pill tone={tone || "mute"}>{enumLabel(status)}</Pill>
        {children}
      </div>
      <TransitionButtons items={items} onTransition={onTransition} />
    </div>
  );
}

export type LineColumn<T> = { label: string; align?: "left" | "right"; render: (row: T) => React.ReactNode };

/** Bordered line-item grid with loading/empty states — the WO-parts / pick-lines
 *  / count-sheet table pulled into one place. */
export function LineTable<T>({
  columns,
  rows,
  loading,
  empty = "No lines yet.",
  rowKey,
}: {
  columns: LineColumn<T>[];
  rows: T[];
  loading?: boolean;
  empty?: string;
  rowKey: (row: T, i: number) => string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-secondary text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th key={c.label} className={cn("px-3 py-2 font-medium", c.align === "right" ? "text-right" : "text-left")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-4 text-center micro">Loading…</td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-4 text-center micro">{empty}</td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={rowKey(r, i)}>
                {columns.map((c) => (
                  <td key={c.label} className={cn("px-3 py-1.5", c.align === "right" ? "text-right" : "text-left")}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
