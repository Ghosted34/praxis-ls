/** Compact KPI tile + row — the glass summary strip at the top of a list screen.
 *  A tenant-tinted accent bar keeps it from feeling flat. Values use the `.num`
 *  tabular class. Kept deliberately short so it doesn't crowd out the table. */
import * as React from "react";
import { cn } from "@/lib/cn";

export function KpiTile({
  label,
  value,
  hint,
  icon,
  delta,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  delta?: { value: React.ReactNode; dir?: "up" | "down" };
}) {
  return (
    <div className="lux-card animate-fade-up relative overflow-hidden px-5 py-[18px] transition-all duration-200 hover:-translate-y-[3px] hover:shadow-[var(--shadow-m)]">
      <div className="flex items-start justify-between gap-2">
        <div className="micro">{label}</div>
        {icon && (
          <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary">
            {icon}
          </span>
        )}
      </div>
      <div className="num mt-2 font-display text-[30px] leading-none">{value}</div>
      {delta && (
        <div
          className={cn(
            "mt-2 inline-flex items-center gap-1 text-[11px] font-semibold",
            delta.dir === "down" ? "text-[rgb(var(--bad))]" : "text-[rgb(var(--ok))]",
          )}
        >
          <span aria-hidden>{delta.dir === "down" ? "▾" : "▴"}</span>
          {delta.value}
        </div>
      )}
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}
