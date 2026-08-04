/**
 * SearchSelect — debounced typeahead over a tenant list endpoint.
 *
 * Relocated from `features/sales/ui.tsx:164` (audit A2, F7). It was the only
 * implementation but lived in a feature folder, so Finance, Operations and two
 * Settings screens imported a form control *from Sales* — the clearest instance
 * of the sideways coupling F7 describes.
 *
 * Behaviour is unchanged from the original: it sends `?q=<term>` (server-side
 * ILIKE where the module supports it) AND narrows the returned rows client-side,
 * so it also works against endpoints that ignore `q`.
 *
 *  - Selecting a row calls `onSelect(row)`.
 *  - `allowFreeText`: the typed string can be committed as-is via `onFreeText`
 *    (for free-text columns like a lead's `company_name`).
 *  - `onCreate`: when a search yields no rows an "Add …" action appears, so the
 *    user can create the missing record inline.
 *
 * ACCESSIBILITY (new — the original had none). This now implements the
 * WAI-ARIA 1.2 combobox-with-listbox pattern: `role="combobox"` with
 * `aria-expanded` / `aria-controls` / `aria-activedescendant`, a `role="listbox"`
 * popup, Up/Down to move through results, Enter to commit the active one,
 * Escape to close. Previously the popup was an unlabelled `<div>` of buttons
 * reachable only by mouse, and the results arriving was announced nowhere —
 * the status line below the input is a live region so screen-reader users hear
 * "6 results" instead of silence.
 *
 * @example
 * <SearchSelect
 *   path="/clients"
 *   label="Client"
 *   value={form.client_name}
 *   placeholder="Search clients…"
 *   getKey={(r) => String(r.client_id)}
 *   getLabel={(r) => String(r.name)}
 *   onSelect={(r) => setForm({ ...form, client_id: String(r.client_id), client_name: String(r.name) })}
 * />
 *
 * BEST PRACTICE. Always pass `label` — it is the control's accessible name and,
 * inside a `<Field>`, should match the field's visible label. Use this over a
 * native `<Select>` once a list can exceed ~20 rows or is tenant-scoped and
 * unbounded (clients, operations, employees); below that a `<Select>` is faster
 * to operate and needs no round trip.
 */
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { cn } from "@/lib/cn";

export type Row = Record<string, unknown>;

export function SearchSelect({
  path,
  value,
  label,
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
  id,
}: {
  path: string;
  value?: string | null;
  /** Accessible name for the control. Match the surrounding `<Field>` label. */
  label?: string;
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
  id?: string;
}) {
  const reactId = React.useId();
  const baseId = id ?? reactId;
  const listId = `${baseId}-listbox`;

  const [term, setTerm] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

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
          setActive(0);
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

  function close(restoreFocus = true) {
    setOpen(false);
    setTerm("");
    // Focus restoration: the input unmounts when the popup closes, so without
    // this the user is dropped back to <body> (the same WCAG 2.4.3 failure the
    // Modal has — see PR2).
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function pick(row: Row) {
    onSelect(row);
    close();
  }

  function commitFreeText() {
    const t = term.trim();
    if (allowFreeText && onFreeText && t) {
      onFreeText(t);
      close();
    }
  }

  const showCreate = !!onCreate && !!term.trim() && rows !== null && rows.length === 0 && !loading;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const n = rows?.length ?? 0;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!n) return;
      e.preventDefault();
      setActive((i) => (((i + (e.key === "ArrowDown" ? 1 : -1)) % n) + n) % n);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows?.[active];
      if (row) pick(row);
      else commitFreeText();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  /** Announced to screen readers as results arrive. */
  const status = loading
    ? "Searching…"
    : rows === null
      ? ""
      : rows.length === 0
        ? "No matches."
        : `${rows.length} result${rows.length === 1 ? "" : "s"}.`;

  return (
    <div ref={boxRef} className="relative">
      {!open ? (
        <button
          ref={triggerRef}
          type="button"
          id={baseId}
          disabled={disabled}
          aria-label={label}
          onClick={() => {
            setOpen(true);
            setRows(null);
          }}
          className="flex w-full items-center justify-between rounded-lg border bg-background px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={value ? "text-foreground" : "text-muted-foreground"}>{value || placeholder || "Search…"}</span>
          <span aria-hidden className="text-muted-foreground">
            ▾
          </span>
        </button>
      ) : (
        <input
          autoFocus
          id={baseId}
          role="combobox"
          aria-label={label}
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={rows?.[active] ? `${baseId}-opt-${active}` : undefined}
          value={term}
          placeholder={placeholder || "Type to search…"}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
        />
      )}

      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
          <p role="status" aria-live="polite" className="sr-only">
            {status}
          </p>
          {loading && <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>}

          <ul id={listId} role="listbox" aria-label={label ? `${label} results` : "Results"} className="m-0 list-none p-0">
            {!loading &&
              rows?.map((r, i) => (
                <li key={getKey(r)} role="none">
                  <button
                    type="button"
                    id={`${baseId}-opt-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(r);
                    }}
                    className={cn(
                      "block w-full rounded-md px-3 py-2 text-left text-sm",
                      i === active ? "bg-muted" : "hover:bg-muted",
                    )}
                  >
                    {getLabel(r)}
                  </button>
                </li>
              ))}
          </ul>

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
                onCreate?.(term.trim());
                close(false);
              }}
              // --primary-ink, not --primary: this is a text label (F13).
              className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-primary-ink hover:bg-primary/10"
            >
              ＋ {createLabel ? createLabel(term.trim()) : `Add “${term.trim()}”`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
