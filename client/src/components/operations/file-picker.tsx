/**
 * The operations-file picker. ONE of them, for the whole product.
 *
 * ── WHAT IT REPLACES ────────────────────────────────────────────────────────
 *
 * Three spellings of the same control, and one of them was broken.
 *
 * Most screens used a `<select>` built from `useList("/operations")`. That
 * endpoint's `page()` clamps every list to 50 rows and says nothing about the
 * rest, so on any tenant past its fiftieth file the fifty-first onward were
 * NOT IN THE DROPDOWN AT ALL. Costing, Fleet, WMS, Procurement, Finance and
 * Commercial each carried their own copy of that bug. It fails silently and in
 * the most convincing way possible: the list looks complete, and the answer to
 * "why can't I pick the Brasseries file" is invisible from the screen.
 *
 * A handful of newer screens used `<SearchSelect path="/operations">`, which
 * searches the server properly — and two of those hand-rolled their own row
 * rendering, so the same file read differently depending on which screen you
 * opened.
 *
 * ── WHY A POPOVER AND NOT AN INLINE DROPDOWN ────────────────────────────────
 *
 * `SearchSelect` renders its results in an `absolute z-50` div INSIDE the
 * form. Inside a `<Dialog>` that grows the dialog: the results push the footer
 * — and therefore Save — down and out of reach, which is exactly the defect
 * `employee-picker.tsx` was rebuilt as a Radix Popover to fix. This follows
 * that proven pattern rather than inventing a second one: the panel is
 * PORTALED, so it floats above the form and the dialog never changes height,
 * and it has a fixed max-height with internal scroll, so a tenant with four
 * thousand files gets the same layout as one with four.
 *
 * ── WHY IT RESOLVES ITS OWN VALUE ───────────────────────────────────────────
 *
 * A form editing an existing invoice holds a `dossier_id` and, very often, no
 * reference to go with it — the API did not join one. The old screens covered
 * that by looking the id up in the clamped list, which is why a file past the
 * fiftieth rendered as a raw uuid.
 *
 * So the picker takes the id alone and names it itself, through
 * `/operations?ids=…` (13930). One request, cached and deduplicated by
 * TanStack Query, shared with every other picker and table on the page. Call
 * sites stay one line and cannot show a stale or wrong label, because there is
 * no second field to get out of step.
 *
 * ── WHAT A ROW SHOWS, AND WHY EACH PART EARNS ITS PLACE ─────────────────────
 *
 *   reference     what the file is called everywhere else, so the pick is
 *                 verifiable against an email or a printed sheet
 *   client        which customer — the first thing anybody narrows by
 *   title         the short name the file was opened with ("Export of Beer")
 *   service       Sea Freight Export / Air Freight Import
 *   B/L or AWB    the transport reference, because that is what a client
 *                 quotes down the phone and what a driver has on his paperwork
 *   opened        the date, to separate this year's file from last year's when
 *                 a repeat customer ships the same commodity every quarter
 *
 * ── SEARCHING ───────────────────────────────────────────────────────────────
 *
 * The server matches the reference, the client name, the B/L and the
 * vessel/flight (`operations_file.repo.listPaged`), including the canonical
 * spelling of a reference typed with or without its separators — so
 * `SL-7Z3K9QW2M4XB-SM` and `SL7Z3K9QW2M4XBSM` both find the same file. This
 * component sends the term and renders what comes back; it never filters a
 * truncated page in the browser, which is the habit that produced the bug
 * above.
 */
import * as React from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PopoverAnchor } from "@/components/ui/popover";
import { useList } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { Dossier } from "@/lib/operations-api";

/** What a picked file is, to the screen that picked it. */
export type PickedFile = {
  dossier_id: string;
  ref: string;
  client_name?: string | null;
  title?: string | null;
};

/** One page of matches. Enough to choose from, short enough to read. */
const PAGE = 15;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** `ref · client`, the shortest phrase that identifies a file unambiguously. */
export function fileLabel(file: { ref?: string | null; client_name?: string | null } | null) {
  if (!file) return "";
  return [str(file.ref), str(file.client_name)].filter(Boolean).join(" · ");
}

export function OperationsFilePicker({
  value,
  onSelect,
  onClear,
  label = "Operations file",
  placeholder,
  disabled,
  id,
  required,
  error,
  hint,
  path = "/operations",
  filter,
  exclude,
}: {
  /** The dossier_id currently chosen. The picker names it itself — callers do
   *  NOT pass a reference, and must not keep one in step with this. */
  value?: string | null;
  onSelect: (file: PickedFile, row: Dossier) => void;
  /** Offered as a Clear button once a file is chosen. Omit on a required field
   *  whose form has no meaning without one. */
  onClear?: () => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  required?: boolean;
  /** Validation message, rendered under the control and wired to aria-invalid. */
  error?: string | null;
  hint?: string;
  /** A different source of files — e.g. an eligibility-filtered endpoint. It
   *  must accept `q` and `limit` and return dossier-shaped rows. */
  path?: string;
  /** Narrow the list — e.g. to one entity, or to files that move goods. */
  filter?: (row: Dossier) => boolean;
  /** Ids already chosen, dropped from the results rather than greyed. */
  exclude?: Set<string>;
}) {
  const reactId = React.useId();
  const baseId = id ?? reactId;
  const listboxId = `${baseId}-listbox`;
  const statusId = `${baseId}-status`;
  const errorId = `${baseId}-error`;

  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);

  // Debounced so a five-letter reference is one request, not five. 250ms is
  // below the threshold at which typing feels like it is waiting.
  React.useEffect(() => {
    const t = setTimeout(() => setQuery(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  /*
   * NAMING THE CURRENT VALUE.
   *
   * `ids=` rather than `/operations/:id`: it is the same query key shape the
   * search uses, so one cache serves both, and a table resolving twenty rows
   * plus three pickers on the same screen collapses into one request rather
   * than twenty-three. `useList` is null-pathed when there is nothing to
   * resolve, so an empty picker costs no request at all.
   */
  const { rows: valueRows, loading: valueLoading } = useList<Dossier>(
    value ? `/operations?ids=${encodeURIComponent(value)}&limit=1` : null,
  );
  const chosen = value ? (valueRows || [])[0] || null : null;

  const sep = path.includes("?") ? "&" : "?";
  const searchPath = open
    ? `${path}${sep}limit=${PAGE}${query ? `&q=${encodeURIComponent(query)}` : ""}`
    : null;
  const { rows, loading, error: searchError } = useList<Dossier>(searchPath);

  const hits = React.useMemo(() => {
    let list = rows || [];
    if (exclude?.size) list = list.filter((r) => !exclude.has(str(r.dossier_id)));
    if (filter) list = list.filter(filter);
    return list;
  }, [rows, exclude, filter]);

  // The page came back full, so there are almost certainly more behind it.
  // Said out loud rather than implied — a silently truncated list is the whole
  // reason this component exists.
  const maybeMore = (rows || []).length >= PAGE;

  React.useEffect(() => {
    setActive(0);
  }, [query, open]);

  function choose(row: Dossier) {
    onSelect(
      {
        dossier_id: str(row.dossier_id),
        ref: str(row.ref),
        client_name: row.client_name ?? null,
        title: row.title ?? null,
      },
      row,
    );
    setTerm("");
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // Only when the list is open AND has a row under the cursor: otherwise
      // Enter belongs to the form, and swallowing it would stop a one-field
      // dialog submitting.
      if (open && hits[active]) {
        e.preventDefault();
        choose(hits[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  const describedBy = [hint ? `${baseId}-hint` : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  /* ── Chosen: name the file, and offer the way out ───────────────────────── */
  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="micro" htmlFor={baseId}>
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
        <div
          id={baseId}
          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <span className="min-w-0 truncate">
            {valueLoading && !chosen ? (
              <span className="text-muted-foreground">{tr("Loading…")}</span>
            ) : chosen ? (
              <>
                <span className="num font-medium">{str(chosen.ref)}</span>
                {chosen.client_name && (
                  <span className="text-muted-foreground"> · {str(chosen.client_name)}</span>
                )}
              </>
            ) : (
              /* Resolved to nothing: the file was deleted, or this reader may
                 not see it. Saying so beats a raw uuid, and beats an empty
                 control that looks like nothing was ever chosen. */
              <span className="text-muted-foreground">{tr("A file you cannot view")}</span>
            )}
          </span>
          {onClear && (
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onClear}>
              {tr("Change")}
            </Button>
          )}
        </div>
        {hint && (
          <p id={`${baseId}-hint`} className="micro">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="micro text-[rgb(var(--bad))]">
            {error}
          </p>
        )}
      </div>
    );
  }

  /* ── Empty: the search ──────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-1.5">
      <label className="micro" htmlFor={baseId}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>

      <RadixPopover.Root open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Input
              id={baseId}
              value={term}
              disabled={disabled}
              placeholder={placeholder || tr("Search by reference, client, B/L or AWB…")}
              autoComplete="off"
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-required={required || undefined}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy || undefined}
              aria-activedescendant={
                open && hits[active] ? `${baseId}-opt-${str(hits[active].dossier_id)}` : undefined
              }
              onFocus={() => {
                if (!disabled) setOpen(true);
              }}
              onChange={(e) => {
                setTerm(e.target.value);
                if (!disabled) setOpen(true);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
        </PopoverAnchor>

        <RadixPopover.Portal>
          <RadixPopover.Content
            aria-label={label}
            align="start"
            side="bottom"
            sideOffset={4}
            collisionPadding={12}
            /*
             * Radix moves focus into the panel on open. For a combobox the
             * caret must stay in the input so the user can keep typing while
             * the list updates beneath it — preventing both defaults keeps it
             * there. Escape and outside-click still close via Radix; choosing
             * a row closes explicitly.
             */
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            className={cn(
              "z-50 w-[var(--radix-popover-trigger-width)] animate-fade-in overflow-hidden",
              "rounded-lg border bg-popover p-0 text-popover-foreground shadow-[var(--shadow-l)]",
            )}
          >
            <div
              id={listboxId}
              role="listbox"
              aria-label={label}
              className="max-h-72 overflow-auto p-1"
            >
              {searchError ? (
                <p className="px-3 py-4 text-sm text-[rgb(var(--bad))]">{searchError}</p>
              ) : loading ? (
                <p className="micro px-3 py-4">{tr("Searching…")}</p>
              ) : hits.length === 0 ? (
                <p className="micro px-3 py-4">
                  {query ? tr("No operations file matches that.") : tr("No operations files yet.")}
                </p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {hits.map((row, i) => {
                    const service =
                      row.service_name_en || row.service_name_fr || row.service_key;
                    // A file carries a B/L or a vessel/flight, never both, so
                    // there is nothing to disambiguate.
                    const transport = row.bl_mawb || row.vessel_flight;
                    return (
                      <li key={str(row.dossier_id)} role="presentation">
                        <button
                          type="button"
                          role="option"
                          id={`${baseId}-opt-${str(row.dossier_id)}`}
                          aria-selected={i === active}
                          disabled={disabled}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => choose(row)}
                          className={cn(
                            "block w-full rounded-md px-3 py-2 text-left text-sm",
                            i === active ? "bg-muted" : "hover:bg-muted",
                          )}
                        >
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="num truncate font-medium text-foreground">
                              {str(row.ref)}
                            </span>
                            {row.created_at && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {dateFmt(row.created_at)}
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-foreground">
                            {str(row.client_name) || "—"}
                          </span>
                          {row.title && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {str(row.title)}
                            </span>
                          )}
                          {(service || transport) && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {[service, transport].filter(Boolean).map(str).join(" · ")}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>

      {/* A live region, so a screen-reader user hears "6 files" instead of
          silence — and hears when the page is capped rather than believing it
          has seen everything. */}
      <p id={statusId} role="status" aria-live="polite" className="micro">
        {error ? (
          <span id={errorId} className="text-[rgb(var(--bad))]">
            {error}
          </span>
        ) : !open ? (
          hint || ""
        ) : loading ? (
          tr("Searching…")
        ) : hits.length === 0 ? (
          tr("No matches")
        ) : maybeMore ? (
          `${hits.length} ${tr("files — keep typing to narrow")}`
        ) : (
          `${hits.length} ${hits.length === 1 ? tr("file") : tr("files")}`
        )}
      </p>
    </div>
  );
}
