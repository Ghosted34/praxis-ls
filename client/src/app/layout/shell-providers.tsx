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
import { fetchNavAccess, NO_ACCESS, type NavAccess } from "@/lib/nav-access";
import { fetchShellPrefs, saveShellPrefs, EMPTY_SHELL_PREFS, type ShellPrefs } from "@/lib/preferences";
import { ShellContext } from "./shell-context";
import { RibbonCommandsContext, type RibbonCommand } from "./ribbon-commands";

/**
 * FAILURE IS "NOTHING", NOT "EVERYTHING". A failed permissions read leaves the
 * ribbon empty rather than full. A full one would offer destinations that 403
 * on click, which reads as a broken product rather than a restricted one — and
 * it would flash a CEO's surface at somebody who is not one.
 */
export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = React.useState<NavAccess>(NO_ACCESS);
  const [prefs, setLocalPrefs] = React.useState<ShellPrefs>(EMPTY_SHELL_PREFS);
  // `ready` covers BOTH reads, and that is load-bearing rather than tidy. The
  // starting preference object is all-null, which is indistinguishable from a
  // first login — so a shell that rendered before the preferences landed would
  // show every returning user a collapsed-to-pinned flicker AND fire the rail's
  // one-time hint at somebody who has already seen it, spending it forever.
  const [settled, setSettled] = React.useState({ access: false, prefs: false });
  const ready = settled.access && settled.prefs;

  React.useEffect(() => {
    let live = true;
    const done = (which: "access" | "prefs") => () =>
      live && setSettled((s) => (s[which] ? s : { ...s, [which]: true }));
    fetchNavAccess()
      .then((a) => live && setAccess(a))
      .catch(() => {})
      .finally(done("access"));
    fetchShellPrefs()
      .then((p) => live && setLocalPrefs(p))
      /*
       * A READ WE COULD NOT MAKE IS NOT A FIRST LOGIN.
       *
       * Swallowing this and settling leaves `prefs` at all-null, and all-null is
       * exactly what the API returns for someone who has never chosen anything.
       * The rail reads that as a first login, fires its one-time hint and
       * records it — so a returning user whose preferences read blipped loses
       * the hint permanently, on a network error they never saw.
       *
       * This is the same bug as the timing one the `ready` flag above fixes,
       * arriving by a different route: there the answer had not come yet, here
       * it never will. Suppressing the hint locally is enough, and is
       * deliberately NOT a write — the server row stays absent, so a genuine
       * first login still gets its hint the next time the read succeeds.
       */
      .catch(() => live && setLocalPrefs((cur) => ({ ...cur, railHintSeen: true })))
      .finally(done("prefs"));
    return () => {
      live = false;
    };
  }, []);

  const setPrefs = React.useCallback((patch: Partial<ShellPrefs>) => {
    setLocalPrefs((cur) => ({ ...cur, ...patch }));
    saveShellPrefs(patch).catch(() => {});
  }, []);

  const value = React.useMemo(() => ({ access, ready, prefs, setPrefs }), [access, ready, prefs, setPrefs]);
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
