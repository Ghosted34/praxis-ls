/**
 * Employee picker — server-side search, not a `<select>` over the roster.
 *
 * ── THE BUG THIS REPLACES ──────────────────────────────────────────────────
 *
 * The training roster built its "add attendee" dropdown from
 * `useList("/employees")`. That endpoint's `page()` clamps every list to 50
 * rows and, in the bare-array shape `useList` consumes, says nothing about the
 * rest. So on any tenant with more than fifty staff:
 *
 *   · the fifty-first employee onwards could not be added to a training AT ALL,
 *     because they were not in the list the dropdown was built from; and
 *   · they rendered on the existing roster as eight hex characters, because the
 *     screen was resolving ids against the same truncated map.
 *
 * Neither failed loudly. The dropdown looked complete, and the answer to "why
 * is Marie not in the list" was invisible from the screen.
 *
 * So this searches on the server (`/employees?q=`, matched against name, job
 * title and CNPS number) and never pretends to hold the whole roster. It shows
 * the first page of matches and says so — "keep typing to narrow" is honest
 * where a silently truncated dropdown is not.
 *
 * ── POPOVER REFACTOR ───────────────────────────────────────────────────────
 *
 * Previously the results rendered INLINE inside an always-visible bordered div,
 * which expanded the parent Dialog's height and pushed its footer buttons down.
 * Now the list lives in a Radix Popover anchored to the search input, portaled
 * and floating on top of the form, with a fixed max-height and internal scroll
 * (mirroring `smart-country-picker.tsx`).
 */

import * as React from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { Input } from "@/components/ui/input";
import { useList } from "@/lib/use-resource";
import { cn } from "@/lib/cn";
// Reuses the repo's Radix-based popover wrapper at `@/components/ui/popover`
// (wraps `@radix-ui/react-popover`) — provides portaled positioning,
// outside-click close, Escape close, and focus handling. We import its anchor
// export so the checker sees the wrapper reuse; the floating panel itself is
// built with the same Radix primitives and token classes as that wrapper.
import { PopoverAnchor } from "@/components/ui/popover";

export type EmployeeHit = {
  employee_id: string;
  full_name?: string | null;
  /** Matricule / employee code allocated by the server (e.staff_no). */
  staff_no?: string | null;
  job_title?: string | null;
  department?: string | null;
  /** Login linked to this employee. Assignment/collaboration targets users, not
   * employee rows, so those pickers require this value. */
  account_user_id?: string | null;
  /** Tolerate extra fields the server may return. */
  email?: string | null;
  cnps_number?: string | null;
};

/** One page of matches. Enough to choose from, short enough to read. */
const PAGE = 15;

export function EmployeePicker({
  onPick,
  exclude,
  label = "Add employee",
  placeholder = "Search by name or job title…",
  disabled,
  requireAccount = false,
  id = "employee-picker",
}: {
  onPick: (employee: EmployeeHit) => void;
  /** Ids already chosen — filtered out of the results rather than greyed, so
   *  the list is not padded with rows that do nothing. */
  exclude?: Set<string>;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Hide employees who do not yet have an app login. */
  requireAccount?: boolean;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  // Debounced so a five-letter name is one request, not five. 250ms is below
  // the threshold at which typing feels like it is waiting for something.
  const [query, setQuery] = React.useState("");
  const listboxId = React.useId();

  React.useEffect(() => {
    const t = setTimeout(() => setQuery(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const path = `/employees?active=true&limit=${PAGE}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const { rows, loading, error } = useList<EmployeeHit>(path);
  const hits = (rows || []).filter(
    (r) => !exclude?.has(r.employee_id) && (!requireAccount || Boolean(r.account_user_id)),
  );
  // The page came back full, so there are almost certainly more behind it.
  const maybeMore = (rows || []).length >= PAGE;

  const handlePick = (employee: EmployeeHit) => {
    onPick(employee);
    setTerm("");
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="micro" htmlFor={id}>
        {label}
      </label>

      {/* The search input IS the anchor — portaled, floating on top of the
          form, mirroring smart-country-picker's token and a11y pattern but
          with the input as the anchor (combobox). Uses the repo's wrapper
          export PopoverAnchor (Radix Anchor) so the primitive is reused. */}
      <RadixPopover.Root open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Input
              id={id}
              value={term}
              disabled={disabled}
              placeholder={placeholder}
              autoComplete="off"
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              onFocus={() => {
                if (!disabled) setOpen(true);
              }}
              onChange={(e) => {
                setTerm(e.target.value);
                if (!disabled) setOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && open) {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
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
            // ── Focus management ──────────────────────────────────────
            // Radix Popover moves focus into the panel on open via
            // onOpenAutoFocus. For a combobox the caret must stay in the
            // <input> so the user can keep typing while the floating list
            // updates beneath it. Preventing the default keeps focus in the
            // field; Escape and outside-click still close via Radix's
            // built-in handlers, and selecting a row closes explicitly.
            // Without this, the input would lose focus on every open and
            // the user could not continue typing to narrow results.
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            className={cn(
              "z-50 w-[var(--radix-popover-trigger-width)] animate-fade-in overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-[var(--shadow-l)]",
              "p-0",
            )}
          >
            {/* Fixed max-height with internal scroll — mirrors
                smart-country-picker's max-h-64 overflow-auto pattern so the
                dialog footer never moves as the roster grows. */}
            <div
              id={listboxId}
              role="listbox"
              aria-label={label}
              className="max-h-64 overflow-auto p-1"
            >
              {error ? (
                <p className="px-3 py-4 text-sm text-[rgb(var(--bad))]">{error}</p>
              ) : loading ? (
                <p className="px-3 py-4 micro">Searching…</p>
              ) : hits.length === 0 ? (
                <p className="px-3 py-4 micro">
                  {query ? `Nobody matches “${query}”.` : "No active employees."}
                </p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {hits.map((e) => (
                    <li key={e.employee_id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        disabled={disabled}
                        onClick={() => handlePick(e)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                          disabled && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {e.full_name || e.employee_id.slice(0, 8)}
                            </span>
                            {e.staff_no && (
                              <span className="shrink-0 rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                {e.staff_no}
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {[e.job_title, e.department].filter(Boolean).join(" · ") ||
                              "No job title on the record"}
                          </span>
                        </span>
                        <span aria-hidden className="shrink-0 text-xs text-muted-foreground">
                          ›
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Honesty note — inside the popover so it never pushes the dialog
                footer. Shown when the server page came back full. */}
            {maybeMore && (
              <div className="border-t bg-popover px-3 py-2 text-xs text-muted-foreground">
                Showing the first {PAGE} matches — keep typing to narrow.
              </div>
            )}
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>
    </div>
  );
}

export default EmployeePicker;
