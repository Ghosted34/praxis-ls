/**
 * Debounce a value — the search-box companion to `useListPaged`.
 *
 * Client-side filtering was free to run on every keystroke because the data
 * was already (partly) in memory. Server-side search is a request, so feeding
 * raw keystrokes to it would fire one per character: typing "SBX-2026" is eight
 * requests, seven of them already stale by the time they land.
 *
 * @example
 * const [q, setQ] = React.useState("");
 * const search = useDebounced(q, 300);
 * const rows = useListPaged("/final-invoices", { q: search });
 */
import * as React from "react";

export function useDebounced<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = React.useState(value);

  React.useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), delayMs);
    // Clearing on every change is what makes this a debounce rather than a
    // throttle: a keystroke inside the window replaces the pending update.
    return () => window.clearTimeout(id);
  }, [value, delayMs]);

  return settled;
}
