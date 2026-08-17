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
 */
import * as React from "react";
import { Input } from "@/components/ui/input";
import { useList } from "@/lib/use-resource";
import { cn } from "@/lib/cn";

export type EmployeeHit = {
  employee_id: string;
  full_name?: string | null;
  job_title?: string | null;
  department?: string | null;
};

/** One page of matches. Enough to choose from, short enough to read. */
const PAGE = 15;

export function EmployeePicker({
  onPick,
  exclude,
  label = "Add employee",
  placeholder = "Search by name or job title…",
  disabled,
  id = "employee-picker",
}: {
  onPick: (employee: EmployeeHit) => void;
  /** Ids already chosen — filtered out of the results rather than greyed, so
   *  the list is not padded with rows that do nothing. */
  exclude?: Set<string>;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [term, setTerm] = React.useState("");
  // Debounced so a five-letter name is one request, not five. 250ms is below
  // the threshold at which typing feels like it is waiting for something.
  const [query, setQuery] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setQuery(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const path = `/employees?active=true&limit=${PAGE}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const { rows, loading, error } = useList<EmployeeHit>(path);
  const hits = (rows || []).filter((r) => !exclude?.has(r.employee_id));
  // The page came back full, so there are almost certainly more behind it.
  const maybeMore = (rows || []).length >= PAGE;

  return (
    <div className="flex flex-col gap-2">
      <label className="micro" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        value={term}
        disabled={disabled}
        onChange={(e) => setTerm(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      <div className="max-h-56 overflow-y-auto rounded-lg border">
        {error ? (
          <p className="px-3 py-4 text-sm text-[rgb(var(--bad))]">{error}</p>
        ) : loading ? (
          <p className="px-3 py-4 micro">Searching…</p>
        ) : hits.length === 0 ? (
          <p className="px-3 py-4 micro">
            {query ? `Nobody matches “${query}”.` : "No active employees."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {hits.map((e) => (
              <li key={e.employee_id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(e)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm",
                    "hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {e.full_name || e.employee_id.slice(0, 8)}
                  </span>
                  <span className="shrink-0 truncate text-xs text-muted-foreground">
                    {[e.job_title, e.department].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {maybeMore && (
        /* Said out loud, because the previous control's whole defect was
           truncating in silence. */
        <p className="micro">
          Showing the first {PAGE} matches — keep typing to narrow.
        </p>
      )}
    </div>
  );
}

export default EmployeePicker;
