/**
 * "Sending in 18s — Undo".
 *
 * ── THE COUNTDOWN IS COSMETIC; THE SERVER OWNS THE DEADLINE ─────────────────
 *
 * This ticks down from `release_at`, but it is not what decides anything. The
 * cancel is a request, and the server answers it against the row's actual state
 * — so a laptop that slept through the window, a clock that is wrong, or a tab
 * that was throttled in the background all produce the same correct outcome:
 * either the message is still HELD and it is cancelled, or it has gone and the
 * user is told so.
 *
 * A timer that hid the button at zero would be lying in the other direction —
 * claiming the message has gone when the flusher has not run yet.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";

export function UndoSendToast({
  releaseAt,
  onUndo,
  onDismiss,
  state,
  error,
}: {
  releaseAt: string;
  onUndo: () => void;
  onDismiss: () => void;
  state: "held" | "cancelling" | "cancelled" | "gone";
  error?: string | null;
}) {
  const [left, setLeft] = React.useState(() =>
    Math.max(0, Math.ceil((new Date(releaseAt).getTime() - Date.now()) / 1000)));

  React.useEffect(() => {
    if (state !== "held") return undefined;
    const t = setInterval(() => {
      setLeft(Math.max(0, Math.ceil((new Date(releaseAt).getTime() - Date.now()) / 1000)));
    }, 500);
    return () => clearInterval(t);
  }, [releaseAt, state]);

  // Once it has certainly gone, get out of the way — but only after a beat, so
  // the outcome is readable rather than a flash.
  React.useEffect(() => {
    if (state === "cancelled" || state === "gone") {
      const t = setTimeout(onDismiss, 4000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [state, onDismiss]);

  return (
    <div
      // `status`, not `alert`: a send going normally is not an interruption, and
      // an assertive live region would talk over whatever the user does next.
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-sm"
    >
      {state === "held" && (
        <>
          <span className="text-sm">
            {left > 0 ? `Sending in ${left}s` : "Sending…"}
          </span>
          <Button size="sm" variant="outline" onClick={onUndo}>Undo</Button>
        </>
      )}
      {state === "cancelling" && <span className="text-sm text-muted-foreground">Stopping…</span>}
      {state === "cancelled" && (
        <>
          <Pill tone="warn">Not sent</Pill>
          <span className="text-sm">Back in your drafts.</span>
        </>
      )}
      {state === "gone" && (
        <>
          <Pill tone="ok">Sent</Pill>
          <span className="text-sm">{error || "Too late to undo — it has already left."}</span>
        </>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="ml-auto rounded px-1 text-muted-foreground hover:text-foreground"
      >
        ×
      </button>
    </div>
  );
}
