/**
 * The navigation trail, wired to the router.
 *
 * This is the only thing that watches `useLocation()` and folds it into the
 * model in `nav-trail.ts`. Everything else — the arrows, the hold-menu, the
 * keyboard shortcuts, the screens that name their own entry — reads it through
 * `useNavTrail()` in `nav-trail-context.ts`.
 *
 * THE ARROWS NAVIGATE THE REAL STACK. `go()` calls `navigate(delta)`, so the
 * browser's own back button, the thumb buttons on a mouse, and a swipe gesture
 * on a trackpad all move the same cursor these arrows do. The trail is a
 * labelled shadow, never a second source of truth — see nav-trail.ts.
 */
import * as React from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import {
  applyLocation,
  canGo,
  labelForPath,
  loadTrail,
  sameScreen,
  saveTrail,
  stepsFrom,
  targetOf,
  titleEntry,
  type NavKind,
  type Trail,
  type TrailEntry,
} from "./nav-trail";
import { NavTrailContext, type NavTrailValue } from "./nav-trail-context";
// Alt+← must not fire while somebody is editing a field — on Windows that chord
// also moves the caret, and stealing it mid-sentence would navigate away from a
// half-filled form. Shared with the rail's Alt+R refresh, which has the same
// problem for the same reason (Option+R types "®").
import { isEditing } from "@/lib/is-editing";

/** The stack position React Router stamped on this entry. Missing only before
 *  the router's first `replaceState`, where 0 is the right answer anyway. */
function historyIndex(): number {
  const state = window.history.state as { idx?: number } | null;
  return typeof state?.idx === "number" ? state.idx : 0;
}

export function NavTrailProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType() as NavKind;
  const [trail, setTrail] = React.useState<Trail>(() => loadTrail());

  const url = location.pathname + location.search;

  /*
   * Fold every location into the trail — DURING RENDER, not in an effect.
   *
   * This is React's "adjust state when the input changes" pattern, and here it
   * is load-bearing rather than a micro-optimisation. Effects run child-first:
   * a screen calling `useTrailTitle("Dossier SLS-2481")` fires its effect
   * BEFORE this component's, so an effect-based fold would overwrite the name
   * the screen just set with the route's generic "Files" on every single
   * navigation. Deriving here runs ahead of every child effect, so the title a
   * screen sets is the last word on its own entry.
   *
   * Keyed on `location.key` rather than on the url: the router mints a fresh
   * key for every history entry and restores the original one on a POP, so it
   * is the only identity that changes on a navigation to the URL you are
   * already on.
   */
  const kindRef = React.useRef<NavKind>(navigationType);
  kindRef.current = navigationType;
  const seenKey = React.useRef<string | null>(null);

  if (seenKey.current !== location.key) {
    seenKey.current = location.key;
    const { label, context } = labelForPath(location.pathname);
    const entry: TrailEntry = {
      idx: historyIndex(),
      url,
      label,
      context,
    };
    setTrail((prev) => applyLocation(prev, entry, kindRef.current));
  }

  // Persistence is the one thing that must NOT happen during render.
  React.useEffect(() => {
    saveTrail(trail);
  }, [trail]);

  const go = React.useCallback(
    (delta: number) => {
      if (!delta) return;
      // Bounded by our own record rather than fired blindly. The browser would
      // happily take a user back past the entry Praxis was opened on and out of
      // the app entirely — inside an installed window, with no address bar to
      // get back from.
      if (!canGo(trail, delta)) return;
      navigate(delta);
    },
    [trail, navigate],
  );

  const setTitle = React.useCallback((label: string) => {
    setTrail((prev) => titleEntry(prev, label));
  }, []);

  const openedFromHere = React.useCallback(
    (current: string) => {
      const behind = targetOf(trail, -1);
      return (
        !!behind && sameScreen(behind.url, current) && behind.url !== current
      );
    },
    [trail],
  );

  /*
   * ALT+← / ALT+→, and ⌘[ / ⌘] on a Mac.
   *
   * Registered even though browsers bind Alt+← themselves, because the two are
   * not equivalent here: ours stops at the entry the app was opened on, and the
   * browser's does not. In an installed window there is no address bar to
   * return from, so a back press that walks out of Praxis is a dead end. Taking
   * the chord means the shortcut and the arrow beside it behave identically.
   */
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat) return;
      if (isEditing(e.target)) return;
      const mac = /Mac|iPhone|iPad/.test(
        navigator.platform || navigator.userAgent,
      );
      const back =
        (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowLeft") ||
        (mac && e.metaKey && !e.altKey && e.key === "[");
      const forward =
        (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowRight") ||
        (mac && e.metaKey && !e.altKey && e.key === "]");
      if (!back && !forward) return;
      e.preventDefault();
      go(back ? -1 : 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go]);

  const value = React.useMemo<NavTrailValue>(
    () => ({
      trail,
      canBack: canGo(trail, -1),
      canForward: canGo(trail, 1),
      backTarget: targetOf(trail, -1),
      forwardTarget: targetOf(trail, 1),
      steps: (direction: -1 | 1) => stepsFrom(trail, direction),
      go,
      setTitle,
      openedFromHere,
    }),
    [trail, go, setTitle, openedFromHere],
  );

  return (
    <NavTrailContext.Provider value={value}>
      {children}
    </NavTrailContext.Provider>
  );
}
