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
      const el = document.querySelector<HTMLElement>(`[data-row-key="${cssEscape(focusId)}"]`);
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
  const globalCss = (typeof CSS !== "undefined" ? CSS : undefined) as { escape?: (s: string) => string } | undefined;
  if (globalCss?.escape) return globalCss.escape(s);
  return s.replace(/["\\]/g, "\\$&");
}
