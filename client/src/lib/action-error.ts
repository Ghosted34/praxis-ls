/**
 * A single place for row-action failures to surface.
 *
 * The prevailing shape across the feature screens is `try { … } finally { … }`
 * with no `catch`: the button spins, the promise rejects, and nothing happens.
 * The user cannot tell a permission error from a validation error from the
 * server being down. It is how the milestone-advance 422 stayed hidden for weeks
 * (session 17 log §6) and how a 403 on Submit presented as "submit not working"
 * (doc/PERMISSION_SWEEP_BACKLOG.md §C).
 *
 * The obvious fix — per-page error state plus an <ErrorState /> in each render —
 * is three edits on every screen, and there were eighteen left. This is one
 * edit each: add `catch (e) { reportActionError(e); }` and the banner mounted in
 * the app shell shows it. No new state, no change to any render tree.
 *
 * For NEW code prefer `useAction` (lib/use-action.ts), which puts the message
 * next to the thing that failed. This exists to retrofit screens cheaply and
 * safely, not to be the better pattern.
 *
 * Deliberately tiny: a module-level value and a set of subscribers. No context
 * provider, because the emitters are event handlers deep in trees that would all
 * need wrapping, and no dependency for what is fifteen lines.
 */
import * as React from "react";
import { errMsg } from "./use-resource";

type Listener = (message: string | null) => void;

let current: string | null = null;
const listeners = new Set<Listener>();

function emit(message: string | null) {
  current = message;
  listeners.forEach((l) => l(message));
}

/** Report a failed action. Accepts anything thrown; formats via errMsg. */
export function reportActionError(e: unknown) {
  const message = errMsg(e);
  // Never let the reporter itself be the thing that breaks a handler.
  if (message) emit(message);
}

export function clearActionError() {
  emit(null);
}

/** Subscribe. Used by the banner in the app shell. */
export function useActionError() {
  const [message, setMessage] = React.useState<string | null>(current);
  React.useEffect(() => {
    listeners.add(setMessage);
    return () => { listeners.delete(setMessage); };
  }, []);
  return message;
}
