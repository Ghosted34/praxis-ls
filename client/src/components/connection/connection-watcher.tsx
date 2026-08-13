/**
 * ConnectionWatcher — the always-on half of the offline story.
 *
 * `ConnectionLost` handles the screen that could not load. This handles every
 * OTHER screen: the one the user is still working in, where the data is already
 * on the page and there is a half-filled form in front of them. Taking that over
 * with a full-panel takeover would be the same mistake as reloading — it would
 * hide the work to explain why the work cannot be saved.
 *
 * So while offline it does exactly two things: it says so, quietly, in the pill
 * at the top of the shell; and it says what is being held for you. Then, on
 * recovery, it reports what actually happened — which is the moment the toast
 * the specification asked for genuinely earns its place, because something DID
 * happen in the background and the user is owed an account of it.
 *
 * WHY THE TOAST DOES NOT SAY "CLICK HERE TO RELOAD". Two reasons. The data on
 * screen refreshes without being asked — this handler invalidates the whole
 * tenant query cache on reconnect (see below), so a click to do the thing that
 * already happened is theatre. And `toast.tsx`'s own guidance is explicit that a
 * control which exists nowhere else must not live in something that times out.
 * The recovery path that DOES need a control — a write the server refused — gets
 * a persistent panel instead, below.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { TENANT_KEY } from "@/lib/query-client";
import { onReconnect, installConnectionMonitor } from "@/lib/connection";
import {
  discardEntry,
  flushOutbox,
  getOutbox,
  queuedCount,
  retryEntry,
  subscribeOutbox,
  installOutbox,
} from "@/lib/outbox";

export function ConnectionWatcher() {
  const toast = useToast();
  const queryClient = useQueryClient();

  // Installed here rather than in main.tsx so the listeners live and die with
  // the shell — under React StrictMode's double-mount both calls are no-ops
  // after the first, which is why both installers return the same teardown.
  React.useEffect(() => {
    const offMonitor = installConnectionMonitor();
    const offOutbox = installOutbox();
    return () => {
      offMonitor();
      offOutbox();
    };
  }, []);

  React.useEffect(
    () =>
      onReconnect(() => {
        // FULL RE-HYDRATE. The outbox flush below invalidates the cache only
        // when it actually SENT something; a reconnect with nothing queued — the
        // common read-only case, a laptop reopened on a working network — left
        // every screen showing whatever it had when the wifi died until the next
        // window focus happened to fire `refetchOnWindowFocus`. Invalidating the
        // whole tenant tree here refetches every mounted screen the instant the
        // server is back, which is what "up to date" in the toast below has to
        // mean. Identity and session re-hydrate on the same signal (see
        // branding-context.tsx and auth-context.tsx).
        void queryClient.invalidateQueries({ queryKey: [TENANT_KEY] });
        // `installOutbox` also flushes on reconnect; `flushOutbox` is a no-op
        // while one is in flight, so this awaits the SAME flush rather than
        // starting a second one — it is here for the summary, not the send.
        void flushOutbox().then(({ sent, rejected }) => {
          if (sent > 0) {
            toast.success(
              `Connection restored — ${sent} ${sent === 1 ? "change was" : "changes were"} sent and your data is up to date.`,
            );
          } else if (queuedCount() === 0) {
            toast.info("Connection restored.");
          }
          if (rejected > 0) {
            toast.error(
              `${rejected} ${rejected === 1 ? "change couldn't be saved" : "changes couldn't be saved"} — see “Not sent” below.`,
            );
          }
        });
      }),
    [toast, queryClient],
  );

  return <RejectedChanges />;
}

/**
 * Writes the server refused, and what to do about them.
 *
 * PERSISTENT, not a toast. These are writes the user believes they made and
 * that did not happen — a 409 on a closed period, a 403 after their role
 * changed while they were offline. Announcing that in something that disappears
 * after eight seconds, possibly while the laptop lid is shut, would be the
 * quiet data loss this whole feature exists to prevent. It stays until a person
 * deals with it.
 */
function RejectedChanges() {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => subscribeOutbox(bump), []);

  const rejected = getOutbox().filter((e) => e.state === "rejected");
  if (rejected.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[59] w-full max-w-sm rounded-lg border border-bad/40 bg-card p-3 shadow-[var(--shadow-l)]">
      <p role="alert" className="text-sm font-medium text-bad">
        {rejected.length === 1
          ? "1 change wasn't saved"
          : `${rejected.length} changes weren't saved`}
      </p>
      <ul className="mt-2 space-y-2">
        {rejected.map((e) => (
          <li key={e.id} className="rounded-md border bg-muted/40 p-2">
            <p className="truncate text-sm text-foreground">{e.label}</p>
            {e.lastError && (
              <p className="mt-0.5 text-micro text-muted-foreground">
                {e.lastError}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                icon={null}
                onClick={() => retryEntry(e.id)}
              >
                Try again
              </Button>
              {/* Discarding is explicit and per-entry. There is no "clear all",
                  because the only safe way to throw away a write someone
                  believes they made is one deliberate decision at a time. */}
              <Button
                size="sm"
                variant="ghost"
                icon={null}
                onClick={() => discardEntry(e.id)}
              >
                Discard
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
