/**
 * Shared Sales/CRM + Commercial UI primitives, re-expressed through the app's
 * --primary design tokens (Pixie "Hub" layout, tenant-tinted). Used by
 * features/sales/pages.tsx and features/commercial/pages.tsx.
 */
import * as React from "react";
import { tenant, ApiError } from "@/lib/api-client";

export type Row = Record<string, unknown>;

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return "You don't have permission to do this.";
    return e.message || "Something went wrong.";
  }
  return "Something went wrong.";
}

export function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function when(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? cell(v) : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtMoney(v: unknown, currency?: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return `${n.toLocaleString()} ${currency ? String(currency) : "XAF"}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Load a resource into state, keyed on a reload nonce. */
export function useList(path: string, nonce: number, enabled = true) {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    let live = true;
    setRows(null);
    setError(null);
    tenant<Row[]>(path)
      .then((d) => live && setRows(Array.isArray(d) ? d : []))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [path, nonce, enabled]);
  return { rows, error };
}

const BADGE: Record<string, string> = {
  NEW: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  OPEN: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  IN_PROGRESS: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  CONTACTED: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  QUALIFIED: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  CONVERTED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  WON: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  LOST: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  TRIAGED: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  CLOSED: "bg-muted text-muted-foreground",
  REVIEWING: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  IN_REVIEW: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  DRAFT: "bg-muted text-muted-foreground",
  SENT: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  ACCEPTED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  REJECTED: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  DECLINED: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  ACTIVE: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  PAUSED: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  ENDED: "bg-muted text-muted-foreground",
  PUBLISHED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  SIGNED_OFF: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  EXPIRED: "bg-muted text-muted-foreground",
  GREEN: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  YELLOW: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  RED: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

export function Badge({ label }: { label: string }) {
  const key = label.toUpperCase();
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[key] ?? "bg-muted text-muted-foreground"}`}>{label.toLowerCase().replace(/_/g, " ")}</span>;
}

/** Pixie-style segmented tab control, driven by --primary. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${value === o.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Pixie-style filter chip row. */
export function Chips({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            value === o.value ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Avatar chip from a display name. */
export function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(name)}</span>
  );
}

/** Small metric tile for the Pixie "Today" metric strip. */
export function MetricTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="lux-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold ${accent ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
