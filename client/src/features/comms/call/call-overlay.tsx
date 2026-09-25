/**
 * The call screen (calls audit PR-6; O4, F1–F5, F9): outgoing, connecting and
 * in the call.
 *
 * Solid and never a blocking layer on a desktop: a card at the bottom right,
 * so the dispatcher can open the shipment they are talking about. On a phone
 * it is a full solid screen. Either way, Minimise turns it into the docked
 * in-call bar (active-call-bar.tsx), which survives navigation.
 *
 * Every banner sits in the layout flow (F3), colours are tokens (F2), the
 * timer's accessible name does not change every second (F9), and motion is
 * left to the reduced-motion-aware utilities.
 *
 * The 29:00 line is the UX half of the 30-minute cap; the call's own clock
 * job ends it at the cap regardless.
 */
import { tr } from "@/lib/i18n";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { PhoneDownIcon, MicIcon, MicOffIcon, MinimizeIcon } from "@/components/ui/icons";
import type { QualitySample } from "./call-engine";
import type { Phase } from "./call-session";
import { RecordingNotice, QualityLine } from "./call-parts";
import { fmtClock, noiseUnavailable } from "./call-time";

type Props = {
  name: string | null;
  phase: Exclude<Phase, "idle" | "incoming" | "ended">;
  elapsedS: number;
  warning: boolean;
  muted: boolean;
  /** Is this call being recorded (the tenant's switch, and not declined). */
  recordingEnabled?: boolean;
  /** Who processes the audio, for the recording notice (G2). */
  processors?: string;
  /** Parts of this side's audio that never reached the server. */
  recordingLost?: number;
  quality?: QualitySample;
  /** Media dropped and is being recovered (§4.7). */
  recovering?: boolean;
  noise?: { enabled: boolean; status: "on" | "off" | "unavailable"; reason: string | null };
  /** The other device looks offline: it may not ring (§4.8). */
  peerOffline?: boolean;
  /** The browser refused to play the other side's voice (E4). */
  audioBlocked?: boolean;
  onTapToHear?: () => void;
  onHangup: () => void;
  onMute: () => void;
  onToggleNoise?: (on: boolean) => void;
  onMinimise?: () => void;
};

export function CallOverlay({
  name, phase, elapsedS, warning, muted,
  recordingEnabled = false, processors = "", recordingLost = 0,
  quality, recovering = false, noise, peerOffline = false, audioBlocked = false,
  onTapToHear, onHangup, onMute, onToggleNoise, onMinimise,
}: Props) {
  const who = name || tr("Someone");
  const status =
    phase === "dialing" || phase === "outgoing"
      ? tr("Calling…")
      : phase === "connecting" ? tr("Connecting…") : null;

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label={`${tr("Voice call")} — ${who}`}
      data-call-surface="screen"
      className="fixed inset-0 z-[70] flex flex-col gap-4 overflow-y-auto bg-background p-6 text-foreground md:inset-auto md:bottom-4 md:right-4 md:max-h-[calc(100vh-2rem)] md:w-[380px] md:rounded-2xl md:border md:border-border md:p-4 md:shadow-[var(--shadow-l)]"
    >
      <header className="flex items-start gap-3">
        <Avatar name={who} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{who}</h2>
          {status ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">{status}</p>
          ) : (
            <p className="font-mono text-2xl tabular-nums" role="timer" aria-label={tr("Call duration")}>
              {fmtClock(elapsedS)}
            </p>
          )}
        </div>
        {onMinimise && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onMinimise} aria-label={tr("Minimise call")} icon={null}>
            <MinimizeIcon width={16} height={16} />
          </Button>
        )}
      </header>

      {/* Banners, in the flow: none can cover another or the timer (F3). */}
      <div className="flex flex-col gap-2">
        {recordingEnabled && <RecordingNotice detail={processors} />}
        {recordingLost > 0 && (
          <Callout tone="warn">
            {tr("Part of this call's audio could not be uploaded — the transcript may be incomplete.")}
          </Callout>
        )}
        {warning && phase === "in_call" && <Callout tone="warn">{tr("1 minute left")}</Callout>}
        {recovering && (
          <p role="status" aria-live="polite" className="text-xs text-warn">{tr("Reconnecting…")}</p>
        )}
        {peerOffline && (phase === "outgoing" || phase === "connecting") && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {tr("Their device looks offline — it may not ring until they open the app")}
          </p>
        )}
        {audioBlocked && (
          <Button size="sm" onClick={onTapToHear} icon={null} className="self-start">
            {tr("Tap to hear")}
          </Button>
        )}
        {quality && phase === "in_call" && <QualityLine quality={quality} />}
        {phase === "in_call" && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {muted ? tr("Your microphone is muted") : tr("Your microphone is on")}
          </p>
        )}
      </div>

      {noise && phase === "in_call" && (
        <div className="flex flex-col gap-1">
          <Checkbox
            checked={noise.enabled}
            onCheckedChange={(on) => onToggleNoise?.(on)}
            label={tr("Yard noise filter")}
          />
          {noise.enabled && noise.status === "unavailable" && (
            <p role="status" className="text-xs text-warn">{noiseUnavailable(noise.reason)}</p>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 md:mt-0">
        {phase === "in_call" && (
          <Button
            variant="outline"
            onClick={onMute}
            aria-pressed={muted}
            className="flex-1"
            icon={muted ? <MicOffIcon width={16} height={16} /> : <MicIcon width={16} height={16} />}
          >
            {muted ? tr("Unmute") : tr("Mute")}
          </Button>
        )}
        <Button variant="destructive" onClick={onHangup} className="flex-1" icon={<PhoneDownIcon width={16} height={16} />}>
          {tr("End call")}
        </Button>
      </div>
    </section>
  );
}
