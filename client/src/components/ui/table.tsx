import * as React from "react";
import { cn } from "@/lib/cn";

// tablecard wrapper — rounded surface card (radius tracks --radius) that clips
// the corners but scrolls horizontally, so wide tables scroll in-card on mobile
// rather than clipping off the viewport edge.
export const Table = ({ className, ...p }: React.HTMLAttributes<HTMLTableElement>) => (
  <div className="animate-fade-up w-full max-w-full overflow-x-auto rounded-[var(--radius)] border bg-card shadow-[var(--shadow-s)]">
    <table className={cn("w-full caption-bottom border-collapse", className)} {...p} />
  </div>
);
export const THead = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn("bg-secondary", className)} {...p} />
);
export const TBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;
export const TR = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr
    className={cn(
      "border-b border-[rgb(var(--ink)_/_0.05)] transition-colors last:border-b-0 hover:bg-[color-mix(in_srgb,var(--primary)_4%,transparent)]",
      className,
    )}
    {...p}
  />
);
/**
 * Density (audit F17): `px-4 py-3.5` gave ~46px rows against a 28-32px category
 * standard (Palantir/Bloomberg/Retool) — roughly 40% fewer rows per screen on a
 * product whose users scan hundreds of shipments. Now `px-3 py-row` (6px) for a
 * 32px row.
 *
 * TH was 9.5px uppercase at 0.14em tracking, which is below comfortable reading
 * size; it is now 11px at 0.06em and uses the retuned --ink-3 via
 * text-muted-foreground, clearing WCAG AA (F13).
 */
export const TH = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn(
      "whitespace-nowrap px-3 py-2 text-left align-middle text-micro font-semibold uppercase text-muted-foreground",
      className,
    )}
    {...p}
  />
);
export const TD = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-3 py-row align-middle text-sm", className)} {...p} />
);
