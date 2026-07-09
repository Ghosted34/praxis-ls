import * as React from "react";
import { cn } from "@/lib/cn";

export const Table = ({ className, ...p }: React.HTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-auto rounded-lg border">
    <table className={cn("w-full caption-bottom text-sm", className)} {...p} />
  </div>
);
export const THead = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn("bg-muted/50 [&_th]:text-muted-foreground", className)} {...p} />
);
export const TBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;
export const TR = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn("border-b transition-colors hover:bg-muted/40", className)} {...p} />
);
export const TH = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn("h-11 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wide", className)} {...p} />
);
export const TD = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-4 py-3 align-middle", className)} {...p} />
);
