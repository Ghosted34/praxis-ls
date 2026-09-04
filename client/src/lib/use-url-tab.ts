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

    /*
     * WHY THIS WAITS RATHER THAN LOOKING ONCE.
     *
     * It used to be a single `requestAnimationFrame` — enough for a field on a
     * tab, because the tab renders in the same commit. It is NOT enough for a
     * field inside a MODAL, which is the destination for most of these links:
     * the dialog mounts through a portal, one or more commits later, and often
     * after a lookup fetch resolves. One frame finds nothing, returns, and the
     * deep link silently does nothing — which is the exact failure `?field=`
     * already had at the section level.
     *
     * So it retries for a short budget and stops the moment it lands. A found
     * field costs one frame as before; a field that never arrives costs half a
     * second of cheap DOM queries and then gives up quietly.
     */
    let raf = 0;
    let tries = 0;
    const MAX_TRIES = 30; // ~500ms at 60fps
    let ringed: HTMLElement | null = null;
    let timer = 0;

    const look = () => {
      const el = document.querySelector<HTMLElement>(
        `[data-field="${CSS.escape(field)}"]`,
      );
      if (!el) {
        if (++tries < MAX_TRIES) raf = requestAnimationFrame(look);
        return;
      }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const focusable = el.matches("input, select, textarea, button")
        ? el
        : el.querySelector<HTMLElement>("input, select, textarea, button");
      focusable?.focus({ preventScroll: true });
      el.classList.add("praxis-field-highlight");
      ringed = el;
      timer = window.setTimeout(() => {
        el.classList.remove("praxis-field-highlight");
        ringed = null;
      }, HIGHLIGHT_MS);
    };
    raf = requestAnimationFrame(look);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      // Leaving the ring behind on an element that outlives the effect is how a
      // highlight ends up stuck on a field nobody linked to.
      ringed?.classList.remove("praxis-field-highlight");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, ...deps]);

  return field;
}

/**
 * `?edit=<what>&row=<id|new>` — "open this modal on arrival, on this row".
 *
 * WHY THE URL OPENS A DIALOG AT ALL. Every field a signature reports as missing
 * is edited in one, and a link that lands on the section holding the dialog's
 * "Add…" button has not taken anyone to the field — it has taken them to the
 * button that reveals it. For a reader who does not already know the screen,
 * that is the same dead end as landing on the tab.
 *
 * WHY IT STRIPS ITSELF. `edit`/`row` describe an ARRIVAL, not a location. Left
 * in the address bar they make the dialog part of the page's identity: dismiss
 * it, hit refresh or Back, and it is in your face again — the browser correctly
 * restoring a state you deliberately left. So `clear()` removes exactly those
 * two and keeps `tab`/`field`/`focus`, which ARE the location: a refresh after
 * closing leaves you on the right tab with the right field still ringed.
 *
 * `replace`, so the stripped URL does not add a history entry — Back should
 * leave the screen, not undo a modal the user already closed.
 *
 * @param what  the value of `?edit=` this screen answers to ("employee",
 *              "addresses", "entity", "motto"). Screens ignore any other value,
 *              so one contract serves them all without a registry.
 */
export function useDeepLinkEdit(what: string): {
  /** True while the URL is asking for this modal. */
  open: boolean;
  /** The row id to edit, or "new" to create. Null when not asked for. */
  row: string | null;
  /** Call from the modal's onClose. */
  clear: () => void;
} {
  const [params, setParams] = useSearchParams();
  const open = params.get("edit") === what;
  const row = open ? params.get("row") : null;

  const clear = React.useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("edit");
        next.delete("row");
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  return { open, row, clear };
}
