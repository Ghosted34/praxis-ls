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
export const TH = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn(
      "whitespace-nowrap px-4 py-3.5 text-left align-middle text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground",
      className,
    )}
    {...p}
  />
);
export const TD = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-4 py-3.5 align-middle text-[13px]", className)} {...p} />
);
