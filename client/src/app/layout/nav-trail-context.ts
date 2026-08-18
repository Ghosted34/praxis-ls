/**
 * The navigation trail's context and the hooks that read it.
 *
 * SPLIT FROM THE PROVIDER (`nav-trail-provider.tsx`) for the same reason
 * `shell-context.ts` is split from `shell-providers.tsx`: a module that exports
 * both a component and the hooks around it defeats Fast Refresh, so editing a
 * hook here would remount the whole shell instead of hot-swapping.
 *
 * A DEFAULT VALUE, NOT A THROW, when there is no provider. Screens are rendered
 * in isolation by `test/screen-harness.tsx` and by Ladle, neither of which
 * mounts the app shell. A hook that threw there would make `useTrailTitle` — a
 * one-line addition to a feature page — break that page's whole test file. The
 * inert default costs nothing and keeps naming an entry a safe thing to add.
 */
import * as React from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { EMPTY_TRAIL, type Trail, type TrailEntry } from "./nav-trail";

export type NavTrailValue = {
  trail: Trail;
  canBack: boolean;
  canForward: boolean;
  /** Where a plain click on each arrow lands — the tooltips name these. */
  backTarget: TrailEntry | undefined;
  forwardTarget: TrailEntry | undefined;
  /** Everything reachable in one direction, nearest first, for the hold-menu. */
  steps: (direction: -1 | 1) => { entry: TrailEntry; delta: number }[];
  /** Move `delta` steps, if the trail reaches that far. */
  go: (delta: number) => void;
  /** Name the entry the user is standing on. Prefer `useTrailTitle`. */
  setTitle: (label: string) => void;
  /** True when the entry behind is the same screen without the record open —
   *  i.e. closing the record should step back rather than push a new URL. */
  openedFromHere: (url: string) => boolean;
};

const INERT: NavTrailValue = {
  trail: EMPTY_TRAIL,
  canBack: false,
  canForward: false,
  backTarget: undefined,
  forwardTarget: undefined,
  steps: () => [],
  go: () => {},
  setTitle: () => {},
  openedFromHere: () => false,
};

export const NavTrailContext = React.createContext<NavTrailValue>(INERT);

export function useNavTrail(): NavTrailValue {
  return React.useContext(NavTrailContext);
}

/**
 * Name the current history entry from the screen that knows the name.
 *
 * A route can only ever say "Files". The page that has a dossier open is the
 * one thing in the app that can say "Dossier SLS-2481", which is what makes the
 * back tooltip and the hold-menu worth reading. Pass `null` when nothing is
 * open and the route's own label stands.
 *
 * @example
 * useTrailTitle(open ? `Dossier ${open.ref}` : null);
 */
export function useTrailTitle(label: string | null | undefined): void {
  const { setTitle } = useNavTrail();
  React.useEffect(() => {
    if (label) setTitle(label);
  }, [label, setTitle]);
}

/**
 * Open and close a record THROUGH THE URL, so it is a place the user can come
 * back to.
 *
 * The problem this solves is the one that makes a back button feel broken. A
 * dossier, a client, an employee — none of them is a route; every one is a
 * modal or a detail pane held in `useState`, so the URL never changed when you
 * opened one. Back from an open dossier therefore left the Operations area
 * entirely, and forward could never re-open it, because as far as the browser
 * was concerned nothing had happened.
 *
 * Writing `?focus=<id>` makes opening a record a real history entry. The param
 * is the one this app already reads — `lib/use-focus-row.ts` receives it from
 * the Control Tower's shipment rows and from the client 360's drill-in — so
 * deep links that already existed now round-trip through the arrows too.
 *
 * CLOSING STEPS BACK when the entry behind is the same screen without the
 * record. The alternative — deleting the param with a push — leaves the list on
 * the stack twice, so the back arrow returns you to the record you just closed.
 * That is the single most common way a history-aware modal goes wrong.
 */
export function useRecordParam<T>(
  rows: readonly T[] | null | undefined,
  idOf: (row: T) => string,
  options?: { param?: string },
): {
  /** The row the URL is pointing at, once the list holding it has loaded. */
  record: T | null;
  id: string | null;
  /** User opened a record — a new step in the trail. */
  open: (row: T) => void;
  /** Same, by id, for a record the list does not hold yet — the one a form
   *  just created, where the reload that will contain it is still in flight. */
  openId: (id: string) => void;
  /** User closed it — steps back where that is the same screen. */
  close: () => void;
  /** The screen chose a record for the user (a detail pane's first row). Same
   *  URL, but `replace`: nobody navigated, so nothing should be steppable. */
  preselect: (row: T) => void;
} {
  const param = options?.param ?? "focus";
  const [params, setParams] = useSearchParams();
  const { openedFromHere, go } = useNavTrail();
  const location = useLocation();
  const id = params.get(param);

  // `idOf` is an inline arrow at every call site, so a fresh identity on every
  // render. Held in a ref rather than taken as a dep, which would make every
  // memo and callback below rebuild continuously.
  const idOfRef = React.useRef(idOf);
  idOfRef.current = idOf;

  /*
   * THE RESOLVED ROW IS LATCHED, not derived fresh each render, and the reason
   * is a regression this would otherwise introduce.
   *
   * Reading `rows.find(...)` directly is the obvious implementation, and it
   * closes the record the moment the row leaves the list. Advance a dossier to
   * COMPLETED while the Files tab is filtered to Open, the list reloads without
   * it, and the 360 the user is reading vanishes mid-sentence. Holding the last
   * row we resolved for this id keeps the record open until the URL says
   * otherwise — which is the only thing that should ever close it.
   */
  const [held, setHeld] = React.useState<T | null>(null);
  React.useEffect(() => {
    if (!id) {
      setHeld(null);
      return;
    }
    const hit = rows?.find((r) => idOfRef.current(r) === id);
    if (hit) setHeld(hit);
  }, [id, rows]);

  const record = id ? held : null;

  const write = React.useCallback(
    (value: string | null, replace: boolean) => {
      const next = new URLSearchParams(params);
      if (value === null) next.delete(param);
      else next.set(param, value);
      setParams(next, { replace });
    },
    [params, setParams, param],
  );

  const open = React.useCallback(
    (row: T) => {
      // Latched here as well as in the effect above, so the 360 paints on the
      // click rather than a frame later once the URL has round-tripped.
      setHeld(row);
      write(idOfRef.current(row), false);
    },
    [write],
  );

  const openId = React.useCallback(
    (value: string) => {
      // No row to latch — the effect above resolves it once the list reloads.
      setHeld(null);
      write(value, false);
    },
    [write],
  );

  const preselect = React.useCallback(
    (row: T) => {
      setHeld(row);
      write(idOfRef.current(row), true);
    },
    [write],
  );

  const close = React.useCallback(() => {
    if (openedFromHere(location.pathname + location.search)) go(-1);
    else write(null, true);
  }, [openedFromHere, go, write, location.pathname, location.search]);

  return { record, id, open, openId, close, preselect };
}
