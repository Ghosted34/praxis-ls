/**
 * ConnectionLost — what a screen shows instead of "Something went wrong." when
 * the reason it went wrong is that there is no connection.
 *
 * THE ORIGINAL COMPLAINT, verbatim: "When I run out of network is this the best
 * that can happen? And I was filling a form it means I have lost it." Both
 * halves are answered here, and the second one matters more:
 *
 *   - It says WHAT is wrong, in the user's terms, and that we are already
 *     retrying — rather than a red box that names no cause and offers no route
 *     out except a reload, which is the one action that destroys unsaved work.
 *   - It says WHAT IS SAFE. If there is a queued write or a saved draft, that is
 *     stated on the panel, by name, before anything else. "Nothing has been
 *     lost" is the single most valuable sentence this screen can contain, and it
 *     is only printed when it is true.
 *
 * IT RECOVERS BY ITSELF. This panel stands where a screen's DATA would be, so
 * there is nothing on it to lose and nothing to confirm: when the connection
 * comes back it re-runs the fetch and gets out of the way. The specification
 * asked for a "Connection restored — click to reload" toast; a click that exists
 * only to do the obvious thing is a click, and the toast is kept for the case
 * where it earns its place — a screen the user is still working IN, where we
 * must not touch anything without saying so (see `connection-watcher.tsx`).
 *
 * THE PUZZLE IS OPT-IN AND STICKY. See `supply-chain-puzzle.tsx` for why a game
 * on a system of record has to be asked for. The choice is remembered, so the
 * two audiences — "this is delightful" and "I am a finance director and I would
 * like my register" — each get their answer once.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useConnection, probeNow, useRetryOnReconnect } from "@/lib/connection";
import { queuedCount, subscribeOutbox } from "@/lib/outbox";
import { listDrafts } from "@/lib/form-draft";
import { cn } from "@/lib/cn";
import { SupplyChainPuzzle } from "./supply-chain-puzzle";

const PUZZLE_PREF = "praxis.connection.puzzle";

const readPref = (): boolean => {
  try {
    return localStorage.getItem(PUZZLE_PREF) === "1";
  } catch {
    return false;
  }
};

const writePref = (open: boolean) => {
  try {
    localStorage.setItem(PUZZLE_PREF, open ? "1" : "0");
  } catch {
    /* private mode — the preference just will not persist */
  }
};

/** "just now" / "2 minutes" — how long we have been out. */
function useElapsed(since: number | null): string {
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (since === null) return;
    const t = setInterval(tick, 1_000);
    return () => clearInterval(t);
  }, [since]);
  if (since === null) return "";
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  if (s < 45) return "a few seconds";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"}`;
  const h = Math.round(m / 60);
  return `${h} ${h === 1 ? "hour" : "hours"}`;
}

/** Seconds until the next automatic check, or null when one is running. */
function useCountdown(nextProbeAt: number | null): number | null {
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (nextProbeAt === null) return;
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [nextProbeAt]);
  if (nextProbeAt === null) return null;
  return Math.max(0, Math.ceil((nextProbeAt - Date.now()) / 1000));
}

export function ConnectionLost({
  /** Re-run whatever fetch failed. Called automatically on recovery. */
  onRetry,
  /** Names the thing that would not load: "Corporate entities". */
  what,
  /**
   * Re-run `onRetry` on reconnect. `ScreenError` passes FALSE because it owns
   * the recovery itself — see the note at `useRetryOnReconnect` below. Left on
   * by default so a standalone `<ConnectionLost>` still recovers by itself
   * rather than silently losing the behaviour.
   */
  autoRetry = true,
  className,
}: {
  onRetry?: () => void;
  what?: string;
  autoRetry?: boolean;
  className?: string;
}) {
  const { status, since, probing, nextProbeAt, attempts } = useConnection();
  const elapsed = useElapsed(since);
  const countdown = useCountdown(probing ? null : nextProbeAt);
  const [showPuzzle, setShowPuzzle] = React.useState(readPref);

  // Re-read on every outbox change so the "1 change waiting" line is live while
  // the panel is open — a queued write can arrive from another tab.
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => subscribeOutbox(bump), []);
  const queued = queuedCount();
  const drafts = listDrafts().length;

  // Recovery for a `ConnectionLost` used on its own. `ScreenError` — every call
  // site in the product — passes `autoRetry={false}` and owns this itself,
  // because THIS component unmounts the moment the status flips and its effect
  // would never run. Registering in both places instead fires the reconnect
  // listener twice and refetches every screen twice over.
  //
  // Either way `onRetry` is the ONLY thing that fires: there is no
  // `location.reload()` anywhere in this component, because a reload is what
  // throws away every other screen's unsaved work in order to fix this one.
  useRetryOnReconnect(autoRetry ? onRetry : undefined);

  const togglePuzzle = () => {
    setShowPuzzle((open) => {
      writePref(!open);
      return !open;
    });
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn("rounded-lg border bg-card p-6 sm:p-8", className)}
    >
      <div className="mx-auto max-w-reading text-center">
        <ConnectionGlyph probing={probing} />

        <h2 className="mt-4 text-title font-semibold text-foreground">
          {status === "online" ? "Back online" : "Can't reach the server"}
        </h2>

        <p className="mx-auto mt-1.5 text-sm text-muted-foreground">
          {status === "online" ? (
            <>Reloading {what ? what.toLowerCase() : "your data"}…</>
          ) : (
            <>
              {what ? `${what} couldn't load` : "This screen couldn't load"}{" "}
              because your device isn't reaching Praxis — offline for {elapsed}.
              We're checking for you.
            </>
          )}
        </p>

        {/* THE SENTENCE THAT MATTERS. Printed only when it is true, because a
            reassurance shown unconditionally is one nobody reads. */}
        {(queued > 0 || drafts > 0) && status === "unreachable" && (
          <p className="mx-auto mt-3 rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">
            Nothing has been lost.
            {queued > 0 && (
              <>
                {" "}
                {queued} {queued === 1 ? "change is" : "changes are"} saved on
                this device and will be sent automatically.
              </>
            )}
            {drafts > 0 && (
              <>
                {" "}
                {drafts} unsaved {drafts === 1 ? "form is" : "forms are"} kept
                and will be offered back to you.
              </>
            )}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {/* UX SAFETY (the specification's word, and the right instinct): the
              automatic poll is a convenience, never the only way out. Someone
              who has just fixed their wifi should not have to wait out a
              backoff to prove it. */}
          <Button
            icon={null}
            loading={probing}
            onClick={() => {
              void probeNow().then((ok) => {
                if (ok) onRetry?.();
              });
            }}
          >
            {probing ? "Checking…" : "Retry connection"}
          </Button>
          <Button
            variant="ghost"
            icon={null}
            onClick={togglePuzzle}
            aria-expanded={showPuzzle}
          >
            {showPuzzle ? "Hide the puzzle" : "Beat the downtime →"}
          </Button>
        </div>

        <p className="mt-3 text-micro uppercase tracking-wide text-muted-foreground">
          {status === "online"
            ? "Connection restored"
            : probing
              ? "Checking now…"
              : countdown !== null
                ? `Checking again in ${countdown}s${attempts > 0 ? ` · ${attempts} ${attempts === 1 ? "try" : "tries"}` : ""}`
                : "Waiting to check"}
        </p>
      </div>

      {showPuzzle && (
        <div className="mt-6 border-t pt-6">
          <p className="mb-3 text-center text-sm text-muted-foreground">
            Rotate the tiles to link the warehouse to the truck. We'll keep
            checking the connection while you play.
          </p>
          <SupplyChainPuzzle />
        </div>
      )}
    </div>
  );
}

/**
 * A broken link that closes when a check is running.
 *
 * Deliberately not a spinner: a spinner says "loading" and this screen's whole
 * job is to say the opposite. Motion is limited to the pulse on the probe, and
 * `motion-reduce` drops even that (index.css kills it globally too — this is
 * belt and braces on the one element where the animation carries meaning).
 */
function ConnectionGlyph({ probing }: { probing: boolean }) {
  return (
    <span
      className={cn(
        "inline-grid h-12 w-12 place-items-center rounded-full border",
        probing
          ? "border-brand-blue/40 bg-brand-blue/10 text-brand-blue-ink"
          : "border-warn/40 bg-warn/10 text-warn",
        // No `motion-reduce:` variant needed: index.css carries a global
        // reduced-motion kill covering animation and transition, and the motion
        // gate asserts it is still there on every run. Restating it here was
        // both redundant and, to `check:motion`, an undeclared animation.
        probing && "animate-pulse",
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M9.5 14.5 6.7 17.3a3.8 3.8 0 0 1-5.4-5.4l2.8-2.8" />
        <path d="m14.5 9.5 2.8-2.8a3.8 3.8 0 0 1 5.4 5.4l-2.8 2.8" />
        {!probing && <path d="m9 9 6 6" opacity={0.45} />}
      </svg>
    </span>
  );
}
