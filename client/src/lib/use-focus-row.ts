/**
 * `?focus=<id>` deep-link plumbing — the receiving half of the party-360 KPI
 * drill-in (features/masterdata/party-360.tsx). When a page renders a list of
 * records and the URL carries a `focus` query, the hook returns that id so the
 * page can drive its `DataList`'s `highlightRowKey`, and scrolls the matching
 * `[data-row-key]` element into view once the rows have rendered.
 *
 * The hook also exposes a `clear()` so a page can drop the query param after a
 * user click or when the focus id is not among the loaded rows — the URL then
 * matches what the user sees.
 *
 * Only the FIRST render for a given (id, rows-shape) auto-scrolls. Otherwise a
 * background refresh would tug the viewport away every time the list refetched.
 */
import * as React from "react";
import { useSearchParams } from "react-router-dom";

export function useFocusRow(rows: { length: number } | null | undefined) {
  const [params, setParams] = useSearchParams();
  const focusId = params.get("focus");
  const scrolledFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!focusId || !rows || rows.length === 0) return;
    // A different focus id (or a first load into a non-empty list) — scroll
    // exactly once. `scrolledFor` outlives re-renders from a background reload.
    if (scrolledFor.current === focusId) return;
    // Defer to the next tick so the DataList has committed its DOM.
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-row-key="${cssEscape(focusId)}"]`,
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        scrolledFor.current = focusId;
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [focusId, rows]);

  const clear = React.useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete("focus");
    setParams(next, { replace: true });
  }, [params, setParams]);

  return { focusId, clear };
}

/** `CSS.escape` polyfill for older environments (JSDOM in tests, in particular
 *  — the layout gate runs against real Chromium so the native path is used
 *  there). Kept private to this hook; nothing else should need it. */
function cssEscape(s: string): string {
  const globalCss = (typeof CSS !== "undefined" ? CSS : undefined) as
    { escape?: (s: string) => string } | undefined;
  if (globalCss?.escape) return globalCss.escape(s);
  return s.replace(/["\\]/g, "\\$&");
}

/**
 * `?focus=<id>` for a page whose record opens as a DIALOG from its list —
 * Proposals, Meetings — rather than as a highlighted row or a route.
 *
 * A 360's drill-in lands here with the id of the proposal or meeting the reader
 * clicked. Without this the page ignored it and showed its list, so the click
 * "worked" and still left the reader hunting for the row. Once the list holding
 * the row has loaded, `open(row)` is called exactly once for that id and the
 * parameter is dropped (`replace`), so closing the dialog does not reopen it and
 * a reload does not drag the reader back to it.
 *
 * Only a row the page has LOADED is opened: a list reads its most recent page,
 * and a drill-in links to recent records, so in practice it is there. When it
 * is not, the parameter is dropped and the list is shown — no request to go
 * wrong, and no dialog built from a half-shaped record.
 */
export function useFocusOpen<T>(
  rows: readonly T[] | null | undefined,
  idOf: (row: T) => string,
  open: (row: T) => void,
) {
  const [params, setParams] = useSearchParams();
  const focusId = params.get("focus");
  const handled = React.useRef<string | null>(null);
  // Inline arrows at every call site — held in refs rather than taken as deps,
  // the same reasoning as `useRecordParam`.
  const idOfRef = React.useRef(idOf);
  idOfRef.current = idOf;
  const openRef = React.useRef(open);
  openRef.current = open;

  React.useEffect(() => {
    if (!focusId || rows == null || handled.current === focusId) return;
    handled.current = focusId;
    const hit = rows.find((r) => idOfRef.current(r) === focusId);
    if (hit) openRef.current(hit);
    const next = new URLSearchParams(params);
    next.delete("focus");
    setParams(next, { replace: true });
  }, [focusId, rows, params, setParams]);
}
