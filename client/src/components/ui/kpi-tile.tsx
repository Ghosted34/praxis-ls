/** Compact KPI stat bar — a single slim strip of stats above a list screen,
 *  so four numbers don't eat the vertical space four cards used to. Each tile is
 *  an inline `icon · value · label` cluster; on desktop they share one divided
 *  row, on mobile they stack. Values use the `.num` tabular class. Optional
 *  `tone` tints the icon; `delta` shows a trend chip. Props are unchanged from
 *  the previous card version, so every existing screen inherits this for free.
 *
 *  Passing `onClick` makes the tile a real `<button>` — used by the party 360
 *  KPI strip, where each tile drills into a paginated list of the underlying
 *  rows and deep-links them to their module. */
import * as React from "react";
import { cn } from "@/lib/cn";

const TONE: Record<string, string> = {
  accent:
    "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary-ink",
  ok: "bg-[rgb(var(--ok)_/_0.12)] text-[rgb(var(--ok))]",
  warn: "bg-[rgb(var(--warn)_/_0.15)] text-[rgb(var(--warn))]",
  bad: "bg-[rgb(var(--bad)_/_0.12)] text-[rgb(var(--bad))]",
  info: "bg-[rgb(var(--brand-blue)_/_0.12)] text-[rgb(var(--brand-blue-ink))]",
};

export function KpiTile({
  label,
  value,
  hint,
  icon,
  delta,
  tone = "accent",
  onClick,
  ariaLabel,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  delta?: { value: React.ReactNode; dir?: "up" | "down" };
  tone?: "accent" | "ok" | "warn" | "bad" | "info";
  /** When provided, the tile renders as a `<button>` and reacts to clicks. */
  onClick?: () => void;
  /** Accessible name override for the button variant (defaults to "Open <label>"). */
  ariaLabel?: string;
}) {
  const body = (
    <>
      {icon && (
        <span
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-md text-[14px]",
            TONE[tone],
          )}
        >
          {icon}
        </span>
      )}
      <span className="num text-[18px] font-semibold leading-none">
        {value}
      </span>
      <span className="truncate text-[12px] text-muted-foreground">
        {label}
      </span>
      {delta && (
        <span
          className={cn(
            "ml-auto shrink-0 text-[11px] font-semibold",
            delta.dir === "down"
              ? "text-[rgb(var(--bad))]"
              : "text-[rgb(var(--ok))]",
          )}
        >
          {delta.value}
        </span>
      )}
      {hint && !delta && (
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {hint}
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel || `Open ${label}`}
        // The tile keeps the same footprint as the static variant; the button
        // just adds hover feedback, keyboard focus and a pointer cursor so the
        // drill-in affordance reads without a chrome change.
        className="flex min-w-[9rem] flex-1 items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {body}
      </button>
    );
  }

  return (
    <div className="flex min-w-[9rem] flex-1 items-center gap-2.5 px-4 py-2.5">
      {body}
    </div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col divide-y overflow-hidden rounded-[10px] border bg-card shadow-[var(--shadow-s)] sm:flex-row sm:divide-x sm:divide-y-0">
      {children}
    </div>
  );
}
