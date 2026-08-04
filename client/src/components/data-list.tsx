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
  description?: React.ReactNode;
  action?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b pb-3">
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden className="mt-1 h-7 w-1 shrink-0 rounded-full bg-primary" />
        <div className="min-w-0">
          {eyebrow && <div className="micro mb-1">{eyebrow}</div>}
          {/*
            The <h1> is now unconditional (audit F13). It used to render only
            when `description` was absent — and 116 of 117 call sites pass one,
            so in practice almost every screen in the app shipped with NO h1 at
            all and a flat document outline.

            The visual intent is preserved: inside a hub the tab bar already
            names the screen, so the title stays visually small (`micro`) and the
            description carries the visual weight. It is still a real h1 for
            assistive tech and document structure — `sr-only` is deliberately NOT
            used, because the title is genuinely useful context on screen too.
          */}
          {description ? (
            <>
              <h1 className="micro mb-1">{title}</h1>
              <p className="max-w-prose text-base font-medium leading-snug text-foreground">{description}</p>
            </>
          ) : (
            <h1 className="font-display text-h2 leading-tight">{title}</h1>
          )}
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
  /** `action` is the F11 fix: no empty state in the app offered a primary
   *  control, which is what turns an empty table into an onboarding step. */
  empty?: { title: string; hint?: string; action?: React.ReactNode };
  rowKey: (row: T, i: number) => string;
  onRowClick?: (row: T) => void;
}) {
  if (error) return <ErrorState message={error} />;
  if (loading || rows === null) return <SkeletonTable cols={columns.length} />;
  if (rows.length === 0)
    return (
      <EmptyState
        title={empty?.title || "Nothing here yet"}
        // "No records returned." was the default — a developer's sentence that
        // tells an operator nothing (F11). Still a fallback, but every screen
        // should be passing real copy.
        hint={empty?.hint || "No records returned."}
        action={empty?.action}
      />
    );

  return (
    <>
      {/* Table — sm and up. Below that it would overflow, so we swap to cards. */}
      <div className="hidden sm:block">
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
                  <TD key={c.key} className={c.className}>
                    {c.render ? c.render(r) : cell(r[c.key])}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      {/* Card fallback — phones. Each row becomes a label/value card; unlabelled
          columns (e.g. row actions) render full-width at the foot of the card. */}
      <div className="animate-fade-up space-y-2 sm:hidden">
        {rows.map((r, i) => (
          <div
            key={rowKey(r, i)}
            className={cn("lux-card p-3", onRowClick && "cursor-pointer")}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
          >
            {columns.map((c) => {
              const val = c.render ? c.render(r) : cell(r[c.key]);
              return c.label ? (
                <div key={c.key} className="flex items-baseline justify-between gap-3 py-0.5">
                  <span className="micro shrink-0">{c.label}</span>
                  <span className="min-w-0 text-right text-[13px]">{val}</span>
                </div>
              ) : (
                <div key={c.key} className="mt-2 flex flex-wrap justify-end gap-2">{val}</div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
