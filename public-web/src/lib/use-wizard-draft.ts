import * as React from "react";

/**
 * Keep a multi-step form's answers across a refresh.
 *
 * ── WHY sessionStorage AND NOT localStorage ────────────────────────────────
 *
 * The requirement (`doc/PUBLIC_WEB_PLAN.md` WS2) is "persist wizard state so a
 * refresh does not wipe four steps of input" — a refresh, a back button, a
 * mis-tapped link. All of those are one sitting, and `sessionStorage` covers
 * every one of them.
 *
 * `localStorage` would cover more and would be wrong. A quote draft names a
 * company, a route, a cargo and a phone number, and on the shared machine in a
 * hotel business centre or an internet café — an ordinary way to reach this
 * site in the region this product serves — it would still be there for the next
 * person tomorrow. Losing a draft when the tab closes is a small cost; leaking
 * a prospect's shipment to a stranger is not.
 *
 * ── WHY IT IS CLEARED ON SUCCESS ───────────────────────────────────────────
 *
 * A submitted draft that survives is a form that reappears pre-filled and
 * invites a duplicate — and duplicates in an intake queue cost the desk more
 * than a lost draft costs the prospect.
 *
 * Every access is wrapped: Safari's private mode throws on write, and an
 * exception here would take down a form that works perfectly well without
 * persistence.
 */
export function useWizardDraft<T extends object>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const [state, setState] = React.useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return initial;
      const saved = JSON.parse(raw) as Partial<T>;
      // Spread over `initial` rather than replacing it: a draft written by an
      // older build is missing whatever fields have been added since, and a
      // form whose state has holes in it renders uncontrolled inputs.
      return { ...initial, ...saved };
    } catch {
      return initial;
    }
  });

  /**
   * An UNTOUCHED form stores nothing, and that is what makes `clear` work.
   *
   * The obvious shape — write on every change, `removeItem` in `clear` — does
   * not: `clear` sets the state back to `initial`, that state change runs this
   * effect, and the effect writes the empty draft straight back over the
   * removal. The submitted form then reappears "restored" from a draft nobody
   * wanted, which is precisely the duplicate-invite `clear` exists to prevent.
   *
   * Comparing against the serialised initial fixes that without a flag or an
   * ordering assumption, and it is better behaviour on its own account: a
   * visitor who opens the quote page, reads it and navigates away leaves
   * nothing behind on the machine.
   */
  const emptyJson = React.useRef(JSON.stringify(initial)).current;

  React.useEffect(() => {
    const json = JSON.stringify(state);
    try {
      if (json === emptyJson) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, json);
    } catch {
      // Private mode, or a full quota. The form still works.
    }
  }, [key, state, emptyJson]);

  const clear = React.useCallback(() => {
    setState(initial);
    // `initial` is a module-level constant at every call site; listing it would
    // re-create this callback on every render for no gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [state, setState, clear];
}
