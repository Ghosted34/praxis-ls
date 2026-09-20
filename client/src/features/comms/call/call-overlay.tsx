/**
 * The in-call overlay (Smart Comms PR-1) — the surface for the three phases a
 * call has once the ring is done: outgoing (waiting for the answer),
 * connecting (SDP/ICE in flight) and in_call (media is up).
 *
 * It is a full-bleed layer, not a panel: a call is a modality, the way a
 * payment is, and the thing behind it (whatever screen the user was on) is
 * not the call. The server owns the state; this only renders it and the one
 * control that matters from anywhere — hang-up — plus mute, because a loud
 * yard and a call are the same moment.
 *
 * The 29:00 banner is the UX half of the 30-minute cap: the SERVER sweep ends
 * the call at the cap no matter what, but a tab that is still open deserves
 * the warning first, in the language the user reads in.
 */
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { PhoneDownIcon, MicIcon } from "@/components/ui/icons";
import type { Phase } from "./call-session";

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

type Props = {
  name: string | null;
  phase: Exclude<Phase, "idle" | "incoming" | "ended">;
  elapsedS: number;
  warning: boolean;
  muted: boolean;
  /** The tenant's recording switch (PR-2), as the call row reports it. */
  recordingEnabled?: boolean;
  /** Parts of this side's audio that never reached the server, if any. The
   *  transcript may therefore be missing the last stretch of the call, and the
   *  person in the call is the only one who can still say so. */
  recordingLost?: number;
  onHangup: () => void;
  onMute: () => void;
};

export function CallOverlay({
  name, phase, elapsedS, warning, muted,
  recordingEnabled = false, recordingLost = 0, onHangup, onMute,
}: Props) {
  const status =
    phase === "outgoing" ? tr("Calling…") : phase === "connecting" ? tr("Connecting…") : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name ? `${tr("Voice call")} — ${name}` : tr("Voice call")}
      className="fixed inset-0 z-[70] flex flex-col items-center justify-between bg-[rgb(var(--background)/0.97)] px-6 py-10 backdrop-blur-sm animate-fade-in"
    >
      {/* Header: who, and what phase the server says. */}
      <div className="flex flex-col items-center gap-2 pt-4 text-center">
        <p className="text-lg font-semibold text-foreground">{name || "—"}</p>
        {status ? (
          <p className="text-sm text-muted-foreground">{status}</p>
        ) : (
          <p
            className="font-mono text-5xl tabular-nums text-foreground"
            role="timer"
            aria-label={fmt(elapsedS)}
          >
            {fmt(elapsedS)}
          </p>
        )}
        {phase === "in_call" && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {muted ? tr("Your microphone is muted") : tr("Your microphone is on")}
          </p>
        )}
      </div>

      {/* ── The consent banner (PR-2, decision row 5) ──────────────────────
          ALWAYS ON, on BOTH ends, for the whole call. Not a dismissible toast
          and not a one-time notice: recording is a fact about the call that
          each party is entitled to see the entire time it is true, and the
          person who did NOT press dial is the one it most concerns. It renders
          in the app language of the person reading it, independently on each
          device — neither end's banner depends on the other end having loaded
          anything. */}
      {recordingEnabled && (
        <div
          role="status"
          aria-live="polite"
          className="absolute top-4 left-1/2 flex max-w-[92vw] -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card/90 px-4 py-2 text-xs text-foreground shadow-[var(--shadow-s)]"
        >
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[rgb(var(--bad))]" />
          {tr("This call is recorded and summarized — both parties are informed")}
        </div>
      )}

      {recordingLost > 0 && (
        <p
          role="alert"
          className="absolute top-20 left-1/2 max-w-[92vw] -translate-x-1/2 rounded-lg border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn))/0.12] px-3 py-1.5 text-center text-xs text-foreground"
        >
          {tr("Part of this call's audio could not be uploaded — the transcript may be incomplete.")}
        </p>
      )}

      {/* The one-minute-left banner (29:00). Colour + text: not colour alone. */}
      {warning && phase === "in_call" && (
        <div
          role="alert"
          className="absolute top-24 left-1/2 -translate-x-1/2 rounded-lg border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn))/0.12] px-4 py-2 text-sm text-foreground animate-fade-in"
        >
          {tr("1 minute left")}
        </div>
      )}

      {/* Controls: mute + hang-up. Hang-up is always reachable, full-size, and
          red — the one button a user must never have to look for. */}
      <div className="flex flex-col items-center gap-8 pb-6">
        {phase === "in_call" && (
          <button
            type="button"
            onClick={onMute}
            aria-pressed={muted}
            aria-label={muted ? tr("Unmute") : tr("Mute")}
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-full border transition-colors",
              muted
                ? "border-[rgb(var(--brand-blue))]/50 bg-[rgb(var(--brand-blue))/0.15] text-foreground"
                : "border-border bg-card text-foreground hover:opacity-90",
            )}
          >
            <MicIcon width={22} height={22} />
          </button>
        )}
        <button
          type="button"
          onClick={onHangup}
          aria-label={tr("End call")}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-[rgb(var(--bad))] text-white shadow-[var(--shadow-l)] transition-transform active:scale-95"
        >
          <PhoneDownIcon width={28} height={28} />
        </button>
        <p className="text-xs text-muted-foreground">{tr("End call")}</p>
      </div>
    </div>
  );
}
