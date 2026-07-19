/**
 * DataList + PageHeader — the beautified list scaffold every wired screen composes.
 * The page owns data (via `useList`) and KPIs/forms; this renders the header, the
 * four states (skeleton / error / empty / table), and per-column custom cells
 * (status pills, money, row actions). Design-system only — no raw colour.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { cell } from "@/lib/format";

export type Column<T> = {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
};

// Canonical implementation lives in lib/format.ts (deduped at the 2026-07-18
// merge); re-exported here so existing `import { cell } from "@/components/data-list"`
// callers are unaffected.
export { cell };

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-4 border-b pb-3">
      <div className="flex items-start gap-3">
      <span aria-hidden className="mt-0.5 h-8 w-1 rounded-full bg-gradient-to-b from-primary to-transparent" />
        <div>
          {eyebrow && <div className="micro mb-1">{eyebrow}</div>}
          <h1 className="font-display text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function DataList<T extends Record<string, unknown>>({
  columns,
  rows,
  error,
  loading,
  empty,
  rowKey,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[] | null;
  error: string | null;
  loading: boolean;
  empty?: { title: string; hint?: string };
  rowKey: (row: T, i: number) => string;
  onRowClick?: (row: T) => void;
}) {
  if (error) return <ErrorState message={error} />;
  if (loading || rows === null) return <SkeletonTable cols={columns.length} />;
  if (rows.length === 0)
    return <EmptyState title={empty?.title || "Nothing here yet"} hint={empty?.hint || "No records returned."} />;

  return (
    <Table>
      <THead>
        <TR>
          {columns.map((c) => (
            <TH key={c.key}>{c.label}</TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {rows.map((r, i) => (
          <TR
            key={rowKey(r, i)}
            className={onRowClick ? "cursor-pointer" : undefined}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
          >
            {columns.map((c) => (
              <TD key={c.key} className={cn("text-sm", c.className)}>
                {c.render ? c.render(r) : cell(r[c.key])}
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
