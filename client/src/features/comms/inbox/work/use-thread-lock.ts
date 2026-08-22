/**
 * Hold the shared-inbox soft lock for as long as the composer is open (§9.2).
 *
 * ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
 *
 * Every other piece of the soft lock was already built: `email_thread_lock`,
 * `workflow.takeLock` / `releaseLock`, both routes, the `locked_by_name` join
 * on the thread read, the client wrappers, and the bar in `triage.tsx` that
 * says "Marie is writing a reply". Nothing anywhere CALLED take. So the table
 * could only ever hold zero rows and the bar could only ever be absent — a
 * collision warning that was structurally incapable of firing, above a file
 * header stating that opening the composer takes a two-minute lock.
 *
 * The four standing orphan gates could not see it: `email_thread_lock` IS
 * referenced by a line of `src/`, which is the whole question `mail-orphan-
 * sweep` asks. The missing caller was in the client, where no gate looks.
 *
 * ── POST IS BOTH TAKE AND HEARTBEAT ─────────────────────────────────────────
 *
 * One call, every 30 s, against a lock that expires in two minutes: four
 * chances to renew before it lapses, so a slow request or a suspended laptop
 * loses the lock rather than double-booking it. The route is deliberately
 * total — it never fails because a colleague holds the lock, it returns
 * THEIRS, and `taken` says which happened.
 *
 * ── IT NEVER SURFACES AN ERROR, AND NEVER BLOCKS ────────────────────────────
 *
 * `mail.shared_inbox` is a per-tenant flag, so on a tenant without it every
 * call is a 403. An advisory lock that pops an error toast on a tenant that
 * did not buy the feature is worse than no lock at all. A failure clears the
 * state — which reads as "nobody is holding it", the same as never having
 * asked, and the correct thing to render when we do not know.
 *
 * ── RELEASE ON THE WAY OUT ──────────────────────────────────────────────────
 *
 * Closing the composer releases immediately rather than waiting out the two
 * minutes, because the common case for a second person opening the thread is
 * that the first one just decided not to reply.
 */
import * as React from "react";
import * as work from "@/lib/mail-api-work";

/** Renew four times inside the server's two-minute lease. */
export const LOCK_HEARTBEAT_MS = 30_000;

export function useThreadLock({
  threadId,
  enabled = true,
}: {
  threadId?: string | null;
  enabled?: boolean;
}) {
  const [lock, setLock] = React.useState<work.ThreadLock | null>(null);

  React.useEffect(() => {
    if (!enabled || !threadId) {
      setLock(null);
      return;
    }
    let live = true;
    const beat = () => {
      work
        .takeThreadLock(threadId)
        .then((r) => {
          if (live) setLock(r);
        })
        .catch(() => {
          // See the header: not knowing is rendered as nobody, never as an error.
          if (live) setLock(null);
        });
    };
    beat();
    const timer = setInterval(beat, LOCK_HEARTBEAT_MS);
    return () => {
      live = false;
      clearInterval(timer);
      work.releaseThreadLock(threadId).catch(() => {
        /* @silent:teardown The composer is already unmounted: there is nobody
           left to tell and nothing to retry into. A release that does not land
           costs at most two minutes of a lock that expires on its own, which
           is the whole reason it has an expiry. */
      });
    };
  }, [threadId, enabled]);

  /**
   * Somebody else's lock, or null. Our own is never worth drawing — the person
   * holding it is the one looking at the screen.
   */
  const heldByOther = lock && lock.held_by_other ? lock : null;
  return { lock, heldByOther };
}
