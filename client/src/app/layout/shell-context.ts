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
 * THE ACCESS READ IS OPTIMISTIC. The provider paints from the previous
 * session's cached answer and revalidates behind it (`lib/nav-access-cache.ts`),
 * so the ribbon is never a hole that fills in. That is why there are two
 * "loaded" flags here rather than one, and the difference between them decides
 * what a surface should draw:
 *
 *   `resolved`  there is an ANSWER to render — from cache or from the network.
 *               False only during a true cache miss, which is a first login on
 *               this device. That is the skeleton's condition, and it is also
 *               the condition for "do not filter anything yet", because an
 *               unanswered read looks exactly like a user with no access.
 *   `ready`     both reads have SETTLED against the network. Still what the
 *               one-shot rail hint waits on: firing it off a cached render
 *               would spend it before the preferences that record it have
 *               arrived.
 */
import * as React from "react";
import { NO_ACCESS, type NavAccess } from "@/lib/nav-access";
import { EMPTY_SHELL_PREFS, type ShellPrefs } from "@/lib/preferences";

/**
 * A grant this user has not reloaded to pick up yet.
 *
 * `signature` names the CHANGE rather than the moment, so dismissing it is
 * durable: a later revalidation that finds the same set does not resurrect a
 * banner the user has already read and closed.
 */
export type GrantNotice = { gained: string[]; signature: string };

export type ShellContextValue = {
  access: NavAccess;
  /** False until the permissions read settles against the network, either way. */
  ready: boolean;
  /** True as soon as there is an answer to draw — cached counts. */
  resolved: boolean;
  prefs: ShellPrefs;
  /** Optimistic: applies locally, then persists. A failed write leaves the
   *  local value in place — losing a toggle because the network blinked is
   *  worse than a preference that is one reload out of date. */
  setPrefs: (patch: Partial<ShellPrefs>) => void;
  /** Non-null when this user has GAINED access since the page loaded. A
   *  revocation never appears here — it reloads instead. */
  grantNotice: GrantNotice | null;
  dismissGrantNotice: () => void;
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
 *
 * `resolved: false` is the load-bearing half of this default. Every surface that
 * FILTERS on access — the command palette, the settings grid, the launcher —
 * reads it as "no answer yet, show everything", so a component rendered outside
 * the shell offers its full contents instead of silently collapsing to nothing.
 */
export function useShell(): ShellContextValue {
  return (
    React.useContext(ShellContext) ?? {
      access: NO_ACCESS,
      ready: false,
      resolved: false,
      prefs: EMPTY_SHELL_PREFS,
      setPrefs: () => {},
      grantNotice: null,
      dismissGrantNotice: () => {},
    }
  );
}
