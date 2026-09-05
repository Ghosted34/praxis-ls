/**
 * Finding a member of staff — the shape and the search behind `EmployeeSelect`.
 *
 * ── WHY THE SEARCH IS ON THE SERVER ────────────────────────────────────────
 *
 * `GET /employees` clamps every list to 50 rows (`page()`) and, in the bare
 * array shape `useList` consumes, says nothing about the rest. Three screens
 * built dropdowns straight from it, so on any tenant past fifty staff most of
 * the company simply was not in the list — and nothing said why. The line
 * manager on the employee form was one of them.
 *
 * So the term goes to the server, which matches name, job title and CNPS
 * number, and `truncated` reports a full page rather than pretending it is the
 * whole roster.
 */
import * as React from "react";
import { useList } from "@/lib/use-resource";

export type EmployeeOption = {
  employee_id: string;
  full_name?: string | null;
  staff_no?: string | null;
  job_title?: string | null;
  department?: string | null;
  status?: string | null;
  email?: string | null;
  personal_email?: string | null;
  /** Set by `/users/employees`: this person already has a login. */
  has_account?: boolean | null;
};

export const employeeAddress = (e: EmployeeOption) =>
  e.email || e.personal_email || "";

/** Everything you might type to find somebody, for a CLIENT-side filter over
 *  a list that arrived whole (the linkable-employees list, which is small). */
export const employeeHaystack = (e: EmployeeOption) =>
  `${e.full_name || ""} ${e.staff_no || ""} ${e.job_title || ""} ${e.department || ""} ${employeeAddress(e)}`.toLowerCase();

/** One page of matches: enough to choose from, short enough to read. */
const PAGE = 20;

/**
 * The roster, searched on the SERVER.
 *
 * For any field whose candidates are "anybody on staff". The endpoint matches
 * name, job title and CNPS number, and `truncated` says when the page came back
 * full — because the whole point of replacing the `<select>` was to stop a list
 * from quietly ending at fifty.
 */
export function useEmployeeSearch() {
  const [term, setTerm] = React.useState("");
  // Debounced: a five-letter name is one request, not five. 250ms is below the
  // point at which typing starts to feel like waiting.
  const [query, setQuery] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setQuery(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const path = `/employees?limit=${PAGE}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const { rows, loading, error } = useList<EmployeeOption>(path);
  return {
    employees: rows || [],
    loading,
    error,
    // Hand this straight to `EmployeeSelect`'s `onSearch`. Stable, so the
    // effect that reports the term does not re-fire on every render.
    setTerm: React.useCallback((t: string) => setTerm(t), []),
    /** The page came back full, so there are almost certainly more behind it. */
    truncated: (rows || []).length >= PAGE,
  };
}
