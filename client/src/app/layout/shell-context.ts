/**
 * What the chrome knows: this user's navigation access, and how they have
 * arranged it. The context and its hook; the provider is in
 * `shell-providers.tsx`.
 *
 * WHY A CONTEXT AND NOT A HOOK PER CONSUMER. Four surfaces need the same two
 * answers — the ribbon, the icon rail, the mobile bottom nav, and the rail
 * editor on My appearance. A hook that fetched would fetch four times on every
 * navigation. One provider, mounted once above the shell, fetches once per
 * session.
 *
 * DELIBERATELY NOT A CACHE. `/permissions/mine` returns a `version` digest
 * designed for optimistic rendering — draw the last known ribbon, revalidate
 * behind it, and reconcile a grant differently from a revocation. None of that
 * is here: this is a plain fetch, `ready` is false until it lands, and the
 * ribbon renders nothing in the meantime. That is the correct first version —
 * the cache is worth building against a shell that exists, not before one.
 */
import * as React from "react";
import { NO_ACCESS, type NavAccess } from "@/lib/nav-access";
import { EMPTY_SHELL_PREFS, type ShellPrefs } from "@/lib/preferences";

export type ShellContextValue = {
  access: NavAccess;
  /** False until the permissions read settles, either way. */
  ready: boolean;
  prefs: ShellPrefs;
  /** Optimistic: applies locally, then persists. A failed write leaves the
   *  local value in place — losing a toggle because the network blinked is
   *  worse than a preference that is one reload out of date. */
  setPrefs: (patch: Partial<ShellPrefs>) => void;
};

export const ShellContext = React.createContext<ShellContextValue | null>(null);

/**
 * Returns a usable value OUTSIDE the provider rather than throwing.
 *
 * The opposite of `useToast`'s rule, and for the opposite reason: a toast that
 * goes nowhere hides a failure, whereas the chrome asking "what may I show" and
 * getting "nothing yet" is a real state it already handles on every cold start.
 * A Ladle story or an isolated screen test should not have to mount an auth'd
 * provider to render a page header.
 */
export function useShell(): ShellContextValue {
  return (
    React.useContext(ShellContext) ?? {
      access: NO_ACCESS,
      ready: false,
      prefs: EMPTY_SHELL_PREFS,
      setPrefs: () => {},
    }
  );
}
