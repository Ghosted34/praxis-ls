/**
 * Row actions that report their failures.
 *
 * The prevailing shape in the feature screens is:
 *
 *     async function approve(r) {
 *       setBusyId(r.id);
 *       try { await api.doThing(r.id); reload(); } finally { setBusyId(null); }
 *     }
 *
 * `try`/`finally` with no `catch`: the button spins, the promise rejects, and
 * nothing happens. The row is unchanged and the user is told nothing — they
 * can't tell a permission error from a validation error from the server being
 * down. This is how the milestone-advance 422 stayed hidden for weeks (session
 * 17 log §6), and how a 403 on Submit presented as "submit not working"
 * (doc/PERMISSION_SWEEP_BACKLOG.md §C).
 *
 * This owns the busy id and the error so adopting it is three lines:
 *
 *     const act = useAction();
 *     …
 *     <Button loading={act.busyId === r.id} onClick={() => act.run(r.id, () => api.doThing(r.id).then(reload))}>Approve</Button>
 *     …
 *     {act.error && <ErrorState message={act.error} />}
 *
 * `run` never rejects — callers are event handlers, and an unhandled rejection
 * in one is another silent failure. It returns true on success so a caller can
 * close a modal only when the action actually worked.
 */
import * as React from "react";
import { errMsg } from "./use-resource";

export function useAction() {
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = React.useCallback(async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errMsg(e));
      return false;
    } finally {
      setBusyId(null);
    }
  }, []);

  return { busyId, error, run, clearError: React.useCallback(() => setError(null), []) };
}
