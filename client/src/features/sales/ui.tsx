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

/**
 * SearchSelect — debounced typeahead over a BE list endpoint. It sends `?q=<term>`
 * (server-side ILIKE where the module supports it) AND narrows the returned rows
 * client-side, so it also works against endpoints that ignore `q` (small lists).
 *
 *  - Selecting a row calls onSelect(row).
 *  - allowFreeText: the typed string can be committed as-is via onFreeText (for
 *    free-text columns like a lead's company_name).
 *  - onCreate: when a search yields no rows, an "Add …" action appears so the
 *    user can create the missing record inline (wire it to the create modal).
 *
 * Styled on the app --primary tokens to match the rest of features/sales/ui.tsx.
 */
export function SearchSelect({
  path,
  value,
  placeholder,
  disabled,
  getLabel,
  getKey,
  onSelect,
  allowFreeText,
  onFreeText,
  onCreate,
  createLabel,
  filter,
  queryParam = "q",
  limit = 20,
}: {
  path: string;
  value?: string | null;
  placeholder?: string;
  disabled?: boolean;
  getLabel: (row: Row) => string;
  getKey: (row: Row) => string;
  onSelect: (row: Row) => void;
  allowFreeText?: boolean;
  onFreeText?: (text: string) => void;
  onCreate?: (term: string) => void;
  createLabel?: (term: string) => string;
  filter?: (row: Row) => boolean;
  queryParam?: string;
  limit?: number;
}) {
  const [term, setTerm] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    const h = setTimeout(() => {
      const sep = path.includes("?") ? "&" : "?";
      const qs = `${sep}${queryParam}=${encodeURIComponent(term)}&limit=${limit}`;
      tenant<Row[]>(`${path}${qs}`)
        .then((d) => {
          if (!live) return;
          const raw = Array.isArray(d) ? d : [];
          const list = filter ? raw.filter(filter) : raw;
          const t = term.trim().toLowerCase();
          // Client-side narrowing safety net for endpoints that ignore ?q=.
          setRows(t ? list.filter((r) => getLabel(r).toLowerCase().includes(t)) : list);
        })
        .catch(() => live && setRows([]))
        .finally(() => live && setLoading(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [term, open, path, queryParam, limit, getLabel, filter]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(row: Row) {
    onSelect(row);
    setOpen(false);
    setTerm("");
  }
  function commitFreeText() {
    const t = term.trim();
    if (allowFreeText && onFreeText && t) {
      onFreeText(t);
      setOpen(false);
      setTerm("");
    }
  }

  const showCreate = !!onCreate && !!term.trim() && rows !== null && rows.length === 0 && !loading;

  return (
    <div ref={boxRef} className="relative">
      {!open ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen(true);
            setRows(null);
          }}
          className="flex w-full items-center justify-between rounded-lg border bg-background px-3 py-2 text-left text-sm disabled:opacity-50"
        >
          <span className={value ? "text-foreground" : "text-muted-foreground"}>{value || placeholder || "Search…"}</span>
          <span className="text-muted-foreground">▾</span>
        </button>
      ) : (
        <input
          autoFocus
          value={term}
          placeholder={placeholder || "Type to search…"}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitFreeText();
            }
            if (e.key === "Escape") setOpen(false);
          }}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
        />
      )}
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
          {loading && <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>}
          {!loading &&
            rows &&
            rows.map((r) => (
              <button
                key={getKey(r)}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(r);
                }}
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
              >
                {getLabel(r)}
              </button>
            ))}
          {!loading && rows && rows.length === 0 && !showCreate && !allowFreeText && (
            <p className="px-3 py-2 text-sm text-muted-foreground">No matches.</p>
          )}
          {allowFreeText && term.trim() && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                commitFreeText();
              }}
              className="block w-full rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
            >
              Use “{term.trim()}”
            </button>
          )}
          {showCreate && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onCreate!(term.trim());
                setOpen(false);
              }}
              className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-primary hover:bg-primary/10"
            >
              ＋ {createLabel ? createLabel(term.trim()) : `Add “${term.trim()}”`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
