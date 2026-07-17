/** Compact KPI tile + row — the glass summary strip at the top of a list screen.
 *  A tenant-tinted accent bar keeps it from feeling flat. Values use the `.num`
 *  tabular class. Kept deliberately short so it doesn't crowd out the table. */
import * as React from "react";

export function KpiTile({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="lux-card relative overflow-hidden px-3.5 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-m)]">
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary to-transparent" />
      <div className="flex items-center justify-between gap-2">
        <div className="micro">{label}</div>
        {icon && <span className="text-primary">{icon}</span>}
      </div>
      <div className="num mt-0.5 font-display text-xl leading-tight tracking-tight">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}
