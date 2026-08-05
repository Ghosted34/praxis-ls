/**
 * The shell's two providers.
 *
 * WHY THEY ARE SEPARATED FROM THEIR HOOKS. React Fast Refresh can only replace
 * a module in place when that module exports components and nothing else; a file
 * exporting both `ShellProvider` and `useShell` forces a full reload on every
 * edit, and the lint config reports it. The contexts and hooks therefore live in
 * `shell-context.ts` and `ribbon-commands.ts`, and the components live here.
 *
 * They share a file because they are one thing from the app's point of view —
 * what `app.tsx` and `app-shell.tsx` have to mount for the chrome to work — and
 * because two five-line files would be filing rather than structure.
 */
import * as React from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/app/auth/auth-context";
import { fetchNavAccess, NO_ACCESS, type NavAccess } from "@/lib/nav-access";
import {
  accessSignature, classifyAccessChange, clearCachedAccess, readCachedAccess,
  writeCachedAccess, writeCachedRibbonPinned,
} from "@/lib/nav-access-cache";
import { fetchShellPrefs, saveShellPrefs, EMPTY_SHELL_PREFS, type ShellPrefs } from "@/lib/preferences";
import { queryClient } from "@/lib/query-client";
import { ShellContext, type GrantNotice } from "./shell-context";
import { RibbonCommandsContext, type RibbonCommand } from "./ribbon-commands";

/**
 * How often a revalidation may actually reach the network.
 *
 * The triggers below are FOCUS and NAVIGATION, which in an ERP is a firehose:
 * an operator alt-tabs between a dossier and a spreadsheet continuously, and a
 * hub's tab strip is a navigation per tab. Without a floor, a permissions read
 * would ride on every one of them, and `/permissions/mine` costs a catalogue
 * read plus a grant resolution per call. Fifteen seconds keeps a revocation
 * inside "the next thing you do" while collapsing a burst of twenty focus
 * events into one request.
 */
const MIN_REVALIDATE_MS = 15_000;

/**
 * FAILURE IS "NOTHING", NOT "EVERYTHING". A failed permissions read leaves the
 * ribbon empty rather than full. A full one would offer destinations that 403
 * on click, which reads as a broken product rather than a restricted one — and
 * it would flash a CEO's surface at somebody who is not one.
 *
 * ── WHEN THIS RE-ASKS, AND WHY THOSE MOMENTS ─────────────────────────────────
 *
 * On mount, on every navigation, and on window focus — throttled to one request
 * per `MIN_REVALIDATE_MS`.
 *
 * The alternatives were a poll and a socket. A poll spends a request per user
 * per interval forever to catch an event that happens a handful of times in a
 * tenant's year, and the codebase has already paid for that lesson once (PERF
 * S15, the badge timer in app-shell.tsx). A socket is exact and is the right
 * eventual answer, but it needs a server-side fan-out of `permission.changed`
 * to the affected users' sessions, which is a backend change this PR does not
 * make.
 *
 * Focus and navigation are the low-risk baseline because they bound the damage
 * by the thing that actually matters: a revoked user cannot do anything with a
 * stale ribbon without either clicking a destination (navigation → re-ask) or
 * coming back to the tab (focus → re-ask). And every request they DO make is
 * refused by the server regardless — this loop closes the UI, not the door.
 */
export function ShellProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = (user as { user_id?: string } | null)?.user_id ?? null;
  const { pathname } = useLocation();

  // THE FIRST PAINT COMES FROM THE LAST SESSION. Read once, lazily, at the
  // first render — the provider is mounted inside RequireAuth, so the user is
  // already resolved and cannot change underneath it without a remount.
  const [seed] = React.useState<NavAccess | null>(() => readCachedAccess(userId));
  const [access, setAccess] = React.useState<NavAccess>(seed ?? NO_ACCESS);
  const [resolved, setResolved] = React.useState(seed !== null);
  const [grantNotice, setGrantNotice] = React.useState<GrantNotice | null>(null);
  const [prefs, setLocalPrefs] = React.useState<ShellPrefs>(EMPTY_SHELL_PREFS);
  // `ready` covers BOTH reads, and that is load-bearing rather than tidy. The
  // starting preference object is all-null, which is indistinguishable from a
  // first login — so a shell that rendered before the preferences landed would
  // show every returning user a collapsed-to-pinned flicker AND fire the rail's
  // one-time hint at somebody who has already seen it, spending it forever.
  const [settled, setSettled] = React.useState({ access: false, prefs: false });
  const ready = settled.access && settled.prefs;

  // What the UI is CURRENTLY drawn from — the baseline every fresh answer is
  // diffed against. A ref rather than the `access` state because the comparison
  // happens inside an async callback, where a captured state value would be the
  // one from the render that created the callback.
  const drawnFrom = React.useRef<NavAccess | null>(seed);
  const dismissed = React.useRef<string | null>(null);
  const inFlight = React.useRef(false);
  const lastReadAt = React.useRef(0);
  const alive = React.useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);

  const revalidate = React.useCallback(
    async (force: boolean) => {
      if (inFlight.current) return;
      if (!force && Date.now() - lastReadAt.current < MIN_REVALIDATE_MS) return;
      inFlight.current = true;
      try {
        const fresh = await fetchNavAccess();
        lastReadAt.current = Date.now();
        const change = classifyAccessChange(drawnFrom.current, fresh);

        if (change.kind === "revoked") {
          /*
           * SECURITY AND STATE SYNCHRONISATION FIRST, and no negotiation about
           * it. The user is looking at a view of something they may no longer
           * see; every second of that is a second in which they can read it,
           * copy it, or try to act on it. A banner asking them to reload when
           * convenient is not a control.
           *
           * THE CACHE IS CLEARED BEFORE THE RELOAD, which is what stops this
           * being a loop. Reload with the record still there and the next boot
           * paints the revoked ribbon, diffs it against the same fresh answer,
           * and reloads again. Cleared first, the next boot is a cache miss:
           * skeleton, one read, no delta, no second reload.
           */
          clearCachedAccess(userId);
          // The in-memory read cache goes too. It dies with the page anyway;
          // clearing it explicitly means the moments between here and the
          // navigation cannot serve a component a row from a revoked module.
          queryClient.clear();
          window.location.reload();
          return;
        }

        writeCachedAccess(userId, fresh);
        drawnFrom.current = fresh;
        if (!alive.current) return;
        setAccess(fresh);
        setResolved(true);

        if (change.kind === "granted") {
          // A GRANT CANNOT EXPOSE ANYTHING, so nothing here is urgent enough to
          // throw away a half-written form. Tell them, and let them finish.
          const signature = accessSignature(fresh);
          if (dismissed.current !== signature) setGrantNotice({ gained: change.gained, signature });
        }
      } catch {
        // Keep whatever is on screen. A cached ribbon that is one read out of
        // date beats blanking the chrome because the network blinked; a cache
        // miss falls through to `resolved` with NO_ACCESS, which is the empty
        // ribbon this provider has always shown on failure.
        if (alive.current) setResolved(true);
      } finally {
        inFlight.current = false;
        if (alive.current) setSettled((s) => (s.access ? s : { ...s, access: true }));
      }
    },
    [userId],
  );

  // Mount forces; navigations are throttled. One effect rather than two because
  // the mount IS the first navigation as far as this is concerned.
  const started = React.useRef(false);
  React.useEffect(() => {
    void revalidate(!started.current);
    started.current = true;
  }, [pathname, revalidate]);

  React.useEffect(() => {
    const onFocus = () => void revalidate(false);
    // BOTH events, because they are not the same thing. `focus` fires on
    // returning to the window; `visibilitychange` fires when a background TAB
    // is brought forward without the window ever having lost focus — which is
    // the common case on a desktop with one browser window.
    const onVisible = () => document.visibilityState === "visible" && void revalidate(false);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [revalidate]);

  React.useEffect(() => {
    let live = true;
    fetchShellPrefs()
      .then((p) => live && setLocalPrefs(p))
      .catch(() => {})
      .finally(() => live && setSettled((s) => (s.prefs ? s : { ...s, prefs: true })));
    return () => {
      live = false;
    };
  }, []);

  // Mirror the one preference that changes the chrome's HEIGHT, so the next
  // cold start reserves the right band before any network call resolves. Its
  // own effect, deliberately: it must run whether the value arrived from the
  // API or from a local toggle, and neither of those two paths should have to
  // remember to call it. See PINNED_KEY in lib/nav-access-cache.ts.
  React.useEffect(() => {
    if (prefs.ribbonPinned !== null) writeCachedRibbonPinned(prefs.ribbonPinned);
  }, [prefs.ribbonPinned]);

  const setPrefs = React.useCallback((patch: Partial<ShellPrefs>) => {
    setLocalPrefs((cur) => ({ ...cur, ...patch }));
    saveShellPrefs(patch).catch(() => {});
  }, []);

  const dismissGrantNotice = React.useCallback(() => {
    setGrantNotice((n) => {
      // Remembered so a revalidation five seconds later does not put the same
      // banner straight back. Only the CURRENT change is dismissed — a further
      // grant on top of it is news again.
      if (n) dismissed.current = n.signature;
      return null;
    });
  }, []);

  const value = React.useMemo(
    () => ({ access, ready, resolved, prefs, setPrefs, grantNotice, dismissGrantNotice }),
    [access, ready, resolved, prefs, setPrefs, grantNotice, dismissGrantNotice],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function RibbonCommandsProvider({ children }: { children: React.ReactNode }) {
  // Keyed by publisher so two mounted screens (a hub and a panel inside it)
  // cannot clobber each other, and so retracting is exact rather than "clear
  // everything and hope the survivor re-publishes".
  const [byPublisher, setByPublisher] = React.useState<Record<number, RibbonCommand[]>>({});

  // Idempotent, and that is not an optimisation. Publishing rebuilds the
  // registry object, which re-renders every consumer — including the screen
  // that published — and a `{...cur}` that is always a new object means the
  // re-render publishes again. The app spins. Bailing on an unchanged list is
  // what makes the cycle terminate.
  const publish = React.useCallback((id: number, commands: RibbonCommand[]) => {
    setByPublisher((cur) => (cur[id] === commands ? cur : { ...cur, [id]: commands }));
  }, []);
  const retract = React.useCallback((id: number) => {
    setByPublisher((cur) => {
      if (!(id in cur)) return cur;
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }, []);

  const commands = React.useMemo(() => Object.values(byPublisher).flat(), [byPublisher]);
  const value = React.useMemo(() => ({ commands, publish, retract }), [commands, publish, retract]);
  return <RibbonCommandsContext.Provider value={value}>{children}</RibbonCommandsContext.Provider>;
}
