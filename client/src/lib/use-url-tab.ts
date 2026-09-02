/**
 * URL-ADDRESSABLE TABS, and the field highlight that goes with them.
 *
 * WHY. The 360 dossiers were deep-linkable by route — `entity-360`'s own route
 * comment says it is a full route rather than a tab precisely "so it has to be
 * deep-linkable from a payroll run, an invoice footer config or a compliance
 * alert" — and then held the active tab in `React.useState`, so a link could
 * reach the page and not the thing on it. Someone sent to fix a missing P.O.
 * Box landed on Overview and had eleven tabs to guess from.
 *
 * `?tab=` fixes that. `?field=` is the second half: it scrolls the named input
 * into view, focuses it and rings it briefly, so "the P.O. Box is missing"
 * becomes a link that lands on the box.
 *
 * WHAT `?field=` CANNOT DO. Several dossier collections — addresses, contacts,
 * shareholders — are edited in a modal that opens from a row. A field inside a
 * modal that has not been opened is not in the document, so there is nothing to
 * focus. The hook is a no-op there rather than pretending: the tab is still
 * correct, which is the part that saves the search. Auto-opening a modal would
 * mean guessing WHICH address row the person meant, or creating a new one, and
 * a deep link that silently starts a new record is worse than one that lands a
 * tab away.
 *
 * REPLACE, NOT PUSH. Switching tabs writes with `replace`, so a dossier does
 * not fill the back button with its own tabs — Back returns to wherever the
 * person came from, which is what they mean by it.
 */
import * as React from "react";
import { useSearchParams } from "react-router-dom";

/**
 * A tab bound to `?tab=`.
 *
 * An unknown or absent value resolves to `fallback` rather than rendering
 * nothing — a stale link from an email, or a tab that was renamed since, should
 * open the page, not break it.
 */
export function useUrlTab<T extends string>(
  tabs: readonly T[],
  fallback: T,
  param = "tab",
): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(param);
  const active = (tabs as readonly string[]).includes(raw || "")
    ? (raw as T)
    : fallback;

  const setTab = React.useCallback(
    (next: T) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === fallback) p.delete(param);
          else p.set(param, next);
          // The field highlight belongs to the tab that was linked to. Leaving
          // it set would re-ring a field on every later tab change.
          p.delete("field");
          return p;
        },
        { replace: true },
      );
    },
    [setParams, fallback, param],
  );

  return [active, setTab];
}

/** How long the ring stays. Long enough to find, short enough not to nag. */
const HIGHLIGHT_MS = 2400;

/**
 * Scroll to, focus and briefly ring the element carrying
 * `data-field="<?field= value>"`.
 *
 * Returns the field name so a caller can render its own affordance too.
 *
 * The focus is the accessible half and the ring is the visible one: a sighted
 * user needs to see which of a dozen inputs was meant, and a screen-reader user
 * needs the caret to be in it. Doing only the ring would help one and not the
 * other.
 */
export function useFieldHighlight(deps: React.DependencyList = []): string | null {
  const [params] = useSearchParams();
  const field = params.get("field");

  React.useEffect(() => {
    if (!field) return undefined;
    // One frame, so the tab this field lives on has rendered before the lookup.
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-field="${CSS.escape(field)}"]`,
      );
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const focusable = el.matches("input, select, textarea, button")
        ? el
        : el.querySelector<HTMLElement>("input, select, textarea, button");
      focusable?.focus({ preventScroll: true });
      el.classList.add("praxis-field-highlight");
      window.setTimeout(
        () => el.classList.remove("praxis-field-highlight"),
        HIGHLIGHT_MS,
      );
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, ...deps]);

  return field;
}
