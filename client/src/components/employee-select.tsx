/**
 * Choose ONE person — a searchable combobox, where three screens had a
 * `<select>` over a truncated roster.
 *
 * ── NOT `EmployeePicker`, AND THE DIFFERENCE IS THE VALUE ──────────────────
 *
 * `employee-picker.tsx` is a search box that ADDS to a list: it has no selected
 * value, it calls `onPick` and forgets. That is right for a training roster and
 * wrong for "who does this person report to", which is one field holding one id
 * that has to render as a name when the form opens. This is that control.
 *
 * ── THE THREE THINGS THE `<select>` GOT WRONG ─────────────────────────────
 *
 *   1. It could not show everybody. `GET /employees` clamps to 50 rows
 *      (`page()`), so on any tenant past fifty staff the line-manager dropdown
 *      simply did not contain most of the company — and said nothing about it.
 *      That is the same defect `employee-picker` was written for; it just had
 *      not been fixed here. `useEmployeeSearch` searches on the server instead.
 *   2. It could not be searched. Native type-ahead matches the first letters of
 *      the label, so a four-hundred-row list is a scroll.
 *   3. It showed a bare name. Two people called Ngo Marie is not hypothetical
 *      at that size, so the matricule, the job title and the address are here.
 *
 * ── THE SELECTED PERSON IS ALWAYS NAMEABLE ────────────────────────────────
 *
 * A server-searched list holds one page, and the person already chosen is very
 * often not on it. Resolving the trigger's label from the visible rows alone
 * would blank the field the moment somebody typed in the search box. So the
 * last picked row is remembered, and the caller can pass the name it already
 * knows (`selectedLabel`) for the first render.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Popover, PopoverClose } from "@/components/ui/popover";
import { Pill } from "@/components/ui/pill";
import {
  employeeAddress,
  employeeHaystack,
  type EmployeeOption,
} from "@/lib/employee-search";
import { cn } from "@/lib/cn";

export function EmployeeSelect({
  value,
  onChange,
  employees,
  loading,
  error,
  /** Present ⇒ the list is already filtered server-side; report the term here. */
  onSearch,
  /** Ids to leave out — an employee may not be their own line manager. */
  exclude,
  /** The name the caller already knows, so the first render is not blank. */
  selectedLabel,
  emptyLabel = "— nobody —",
  searchPlaceholder = "Search name, matricule or job title…",
  /** Shown under the control: an environment caveat, a truncation notice. */
  note,
  label = "Employee",
  id,
}: {
  value: string;
  onChange: (employee: EmployeeOption | null) => void;
  employees: EmployeeOption[];
  loading?: boolean;
  error?: string | null;
  onSearch?: (term: string) => void;
  exclude?: string[];
  selectedLabel?: string | null;
  emptyLabel?: string;
  searchPlaceholder?: string;
  note?: React.ReactNode;
  label?: string;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);
  const [picked, setPicked] = React.useState<EmployeeOption | null>(null);

  React.useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);
  React.useEffect(() => {
    if (onSearch) onSearch(q);
  }, [q, onSearch]);

  const excluded = React.useMemo(() => new Set(exclude || []), [exclude]);

  // In that order: the row the server just returned, the row the user picked
  // this session, then the name the caller passed in. See the header.
  const selected: EmployeeOption | null = value
    ? employees.find((e) => e.employee_id === value) ||
      (picked && picked.employee_id === value ? picked : null) ||
      { employee_id: value, full_name: selectedLabel || null }
    : null;

  const rows = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matched = employees
      .filter((e) => !excluded.has(e.employee_id))
      // A server-filtered list is already the answer; filtering it again here
      // against a different rule would drop rows the server matched on a field
      // this side cannot see (the CNPS number, for one).
      .filter((e) => Boolean(onSearch) || !needle || employeeHaystack(e).includes(needle));
    // Already-provisioned last, where the caller marks them: those are the rows
    // you almost never mean, and burying them keeps the top of the list useful.
    return matched.sort((a, b) => {
      const ha = a.has_account ? 1 : 0;
      const hb = b.has_account ? 1 : 0;
      if (ha !== hb) return ha - hb;
      return (a.full_name || "").localeCompare(b.full_name || "");
    });
  }, [q, employees, excluded, onSearch]);

  const pick = (e: EmployeeOption | null) => {
    setPicked(e);
    onChange(e);
    setOpen(false);
    setQ("");
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQ("");
        }}
        align="start"
        label={label}
        className="w-[min(30rem,92vw)] p-0"
        trigger={
          <button
            type="button"
            id={id}
            aria-label={label}
            className="flex h-10 w-full items-center justify-between gap-2 rounded-[10px] border border-input bg-background px-3 text-[13px] text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex min-w-0 items-center gap-2">
              {selected ? (
                <>
                  <span className="truncate font-medium">
                    {selected.full_name || selected.employee_id.slice(0, 8)}
                  </span>
                  {selected.staff_no && (
                    <span className="num shrink-0 text-muted-foreground">
                      {selected.staff_no}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">{tr(emptyLabel)}</span>
              )}
            </span>
            <span aria-hidden className="text-muted-foreground">
              ▾
            </span>
          </button>
        }
      >
        <div className="border-b p-2">
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr(searchPlaceholder)}
            aria-label={tr("Search employees")}
            className="h-8 w-full rounded-md border bg-transparent px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div
          className="max-h-72 overflow-auto p-1"
          role="listbox"
          aria-label={label}
        >
          <PopoverClose asChild>
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => pick(null)}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
            >
              {tr(emptyLabel)}
            </button>
          </PopoverClose>
          {loading && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              {tr("Searching…")}
            </p>
          )}
          {!loading && rows.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              {q.trim() ? tr("Nobody matches that.") : tr("No staff records yet.")}
            </p>
          )}
          {rows.map((e) => {
            const on = e.employee_id === value;
            return (
              <PopoverClose asChild key={e.employee_id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => pick(e)}
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-left hover:bg-muted",
                    on && "bg-primary/10",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {e.full_name || e.employee_id.slice(0, 8)}
                    </span>
                    {e.staff_no && (
                      <span className="num shrink-0 text-xs text-muted-foreground">
                        {e.staff_no}
                      </span>
                    )}
                    {e.has_account && <Pill tone="warn">{tr("Has a login")}</Pill>}
                    {e.status === "PENDING" && (
                      <Pill tone="mute">{tr("Not started")}</Pill>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {[e.job_title, e.department, employeeAddress(e)]
                      .filter(Boolean)
                      .join(" · ") || tr("No job title or address on the record")}
                  </span>
                </button>
              </PopoverClose>
            );
          })}
        </div>
      </Popover>
      {error ? (
        <p className="micro mt-1 text-[rgb(var(--bad))]">
          {tr("Couldn't load staff")}: {error}
        </p>
      ) : (
        note && <p className="micro mt-1">{note}</p>
      )}
    </>
  );
}
