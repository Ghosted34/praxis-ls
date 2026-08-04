/**
 * Shared Operations UI blocks.
 *
 * Split from `./shared` so the pure helpers can be imported without JSX, and
 * lifted out of `features/operations/pages.tsx` in Phase 3 (audit F7) — these
 * five were private to a 928-line file, so a sibling screen needing the same
 * label/value row had to copy it.
 */
import * as React from "react";
import type * as api from "@/lib/operations-api";
import { milestonePct } from "./shared";

/**
 * Milestone progress cell for the files table.
 *
 * A dossier with no chain seeded says so quietly rather than drawing an empty
 * bar at "0%", which reads as broken rather than as untracked.
 */
export function MilestoneCell({ row }: { row: api.Dossier }) {
  if (!row.milestone_total) return <span className="micro">No milestones yet</span>;
  const pct = milestonePct(row);
  return (
    <div className="min-w-[9rem] max-w-[12rem]">
      <div className="micro mb-1 truncate">{row.current_milestone || (pct >= 100 ? "All milestones done" : "—")}</div>
      <div className="flex items-center gap-2">
        <div
          className="h-1.5 flex-1 rounded-full bg-[rgb(var(--ink-3)/0.15)]"
          role="progressbar"
          aria-label={`${row.ref} milestone progress`}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="num text-micro text-muted-foreground">{pct}%</span>
      </div>
    </div>
  );
}

/** Label/value row used across the 360° modal's money tab. */
export function MoneyRow({
  label,
  value,
  strong,
  toneCls,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
  toneCls?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
      <span className={`text-sm ${strong ? "font-medium text-foreground" : "text-muted-foreground"}`}>{label}</span>
      <span className={`num text-sm ${toneCls || (strong ? "font-medium text-foreground" : "text-foreground")}`}>{value}</span>
    </div>
  );
}

/** Role → person row for the 360° modal's people tab. */
export function PersonRow({ role, p }: { role: string; p: api.OverviewPerson | undefined }) {
  const initials = (p?.name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <span className="micro uppercase tracking-wide">{role}</span>
      {p ? (
        <span className="flex items-center gap-2">
          <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-micro font-semibold text-primary-ink">
            {initials}
          </span>
          <span className="text-sm text-foreground">{p.name || p.user_id.slice(0, 8)}</span>
        </span>
      ) : (
        <span className="micro">—</span>
      )}
    </div>
  );
}

/** A titled group of document rows, with its own empty copy. */
export function DocGroup<T>({
  title,
  rows,
  empty,
  render,
  keyOf,
}: {
  title: string;
  rows: T[];
  empty: string;
  render: (r: T) => React.ReactNode;
  keyOf: (r: T) => string;
}) {
  return (
    <div>
      <div className="micro mb-2">{title}</div>
      {rows.length ? (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={keyOf(r)}>{render(r)}</li>
          ))}
        </ul>
      ) : (
        <span className="micro">{empty}</span>
      )}
    </div>
  );
}

/** One row inside a DocGroup — identifier on the left, metadata on the right. */
export function DocRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-1.5">
      {label}
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}
