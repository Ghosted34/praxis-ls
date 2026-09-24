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
import { Button } from "@/components/ui/button";
import type { QualitySample } from "./call-engine";
import type { Phase } from "./call-session";

/** The dot's three states, in the house colour tokens (never colour alone —
 *  the label carries the meaning too). */
const QUALITY_DOT: Record<QualitySample["state"], string> = {
  good: "bg-[rgb(var(--ok))]",
  fair: "bg-[rgb(var(--warn))]",
  poor: "bg-[rgb(var(--bad))]",
};
const QUALITY_LABEL: Record<QualitySample["state"], string> = {
  good: "Good connection",
  fair: "Fair connection",
  poor: "Poor connection",
};

/** The honest one-liner for a filter that did not load (§4.4/§4.7). */
function noiseUnavailable(reason: string | null): string {
  if (reason === "no_audio_context" || reason === "worklet_unsupported") {
    return tr("Yard noise filter unavailable on this browser");
  }
  if (reason === "wasm_load_failed") return tr("Yard noise filter could not load");
  return tr("Yard noise filter unavailable");
}

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
  /** The measured link quality (§3.4). Null-ish samples render the last state
   *  rather than a zero that would look perfect. */
  quality?: QualitySample;
  /** Media dropped and is being recovered — the call may still survive (§4.7). */
  recovering?: boolean;
  /** The outbound noise filter: what the user asked for and what happened. */
  noise?: { enabled: boolean; status: "on" | "off" | "unavailable"; reason: string | null };
  /** The peer's device is offline (no socket anywhere): on iOS, a force-quit
   *  app cannot be rung at all, and the honest thing is to say so before the
   *  60-second silence rather than pretend. */
  peerOffline?: boolean;
  /** The browser refused to play the other side's voice (audit E4). */
  audioBlocked?: boolean;
  onTapToHear?: () => void;
  onHangup: () => void;
  onMute: () => void;
  onToggleNoise?: (on: boolean) => void;
};

export function CallOverlay({
  name, phase, elapsedS, warning, muted,
  recordingEnabled = false, recordingLost = 0,
  quality, recovering = false, noise, peerOffline = false, audioBlocked = false,
  onTapToHear, onHangup, onMute, onToggleNoise,
}: Props) {
  const status =
    phase === "dialing" || phase === "outgoing"
      ? tr("Calling…")
      : phase === "connecting" ? tr("Connecting…") : null;

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

        {/* ── The quality dot (§3.4) ────────────────────────────────────────
            Sampled from getStats(): inbound jitter, RTT, packet loss. The dot
            is not decoration — it is the only way the person holding the phone
            learns that the dropouts are the link and not the other person. */}
        {quality && phase === "in_call" && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            <span aria-hidden className={cn("inline-block h-2 w-2 rounded-full", QUALITY_DOT[quality.state])} />
            {tr(QUALITY_LABEL[quality.state])}
          </p>
        )}

        {/* Media died and is being recovered. Says so, because a frozen screen
            with a live-looking timer is the version of this moment that makes
            people hang up on a call that was about to come back. */}
        {recovering && (
          <p role="status" aria-live="polite" className="text-xs text-[rgb(var(--warn))]">
            {tr("Reconnecting…")}
          </p>
        )}

        {/* Autoplay refused the other side's voice: one tap plays it (E4). */}
        {audioBlocked && (
          <Button size="sm" onClick={onTapToHear} icon={null} className="mt-2">
            {tr("Tap to hear")}
          </Button>
        )}

        {/* The iOS honest line (§4.8): a force-quit PWA, or a device with no
            socket anywhere, cannot be rung. The caller deserves to know before
            the 60 s of silence, not after it. */}
        {peerOffline && (phase === "outgoing" || phase === "connecting") && (
          <p className="max-w-[80vw] text-center text-xs text-muted-foreground" aria-live="polite">
            {tr("Their device looks offline — it may not ring until they open the app")}
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
        {/* The noise filter switch (§4.4): per-user, persisted, live. Shows
            the outcome when it could not load instead of lying that it is on. */}
        {noise && phase === "in_call" && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={noise.enabled}
              onChange={(ev) => onToggleNoise?.(ev.target.checked)}
              className="h-4 w-4 accent-[rgb(var(--brand-blue))]"
            />
            {tr("Yard noise filter")}
          </label>
        )}
        {noise && noise.enabled && noise.status === "unavailable" && (
          <p role="status" className="max-w-[80vw] text-center text-xs text-[rgb(var(--warn))]">
            {noiseUnavailable(noise.reason)}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{tr("End call")}</p>
      </div>
    </div>
  );
}
