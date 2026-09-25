/**
 * The docked in-call bar (calls audit PR-6; O4, F4).
 *
 * What a minimised call looks like: the person, the clock, mute, open the
 * conversation, expand, hang up. It lives in the app shell (comms-live), so
 * it survives navigation and the call keeps running while the person works.
 * Solid, token-coloured, and small enough to leave the page usable: bottom
 * centre on a phone, bottom right on a desktop.
 */
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { PhoneDownIcon, MicIcon, MicOffIcon, ExpandIcon } from "@/components/ui/icons";
import type { Phase } from "./call-session";
import { fmtClock } from "./call-time";

type Props = {
  name: string | null;
  phase: Exclude<Phase, "idle" | "incoming" | "ended">;
  elapsedS: number;
  muted: boolean;
  recordingEnabled?: boolean;
  onMute: () => void;
  onHangup: () => void;
  onExpand: () => void;
  /** Open the call's conversation (hidden when it is already open). */
  onOpenConversation?: () => void;
};

export function ActiveCallBar({
  name, phase, elapsedS, muted, recordingEnabled = false, onMute, onHangup, onExpand, onOpenConversation,
}: Props) {
  const who = name || tr("Someone");
  const status = phase === "in_call"
    ? fmtClock(elapsedS)
    : phase === "connecting" ? tr("Connecting…") : tr("Calling…");
  return (
    <section
      aria-label={`${tr("Voice call")} — ${who}`}
      data-call-surface="bar"
      className="fixed inset-x-2 bottom-2 z-[66] flex items-center gap-2 rounded-2xl border border-border bg-background px-3 py-2 text-foreground shadow-[var(--shadow-l)] md:inset-x-auto md:bottom-4 md:right-4 md:w-[420px]"
    >
      {recordingEnabled && (
        <span className="inline-block h-2 w-2 flex-none rounded-full bg-destructive" title={tr("Recorded")}>
          <span className="sr-only">{tr("Recorded")}</span>
        </span>
      )}
      <button
        type="button"
        onClick={onExpand}
        className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={tr("Open the call")}
      >
        <span className="block truncate text-sm font-semibold">{who}</span>
        <span className="block font-mono text-xs tabular-nums text-muted-foreground">{status}</span>
      </button>
      {phase === "in_call" && (
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onMute} aria-pressed={muted}
          aria-label={muted ? tr("Unmute") : tr("Mute")} icon={null}>
          {muted ? <MicOffIcon width={16} height={16} /> : <MicIcon width={16} height={16} />}
        </Button>
      )}
      {onOpenConversation && (
        <Button variant="ghost" size="sm" onClick={onOpenConversation} icon={null} className="hidden sm:inline-flex">
          {tr("Conversation")}
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onExpand} aria-label={tr("Open the call")} icon={null}>
        <ExpandIcon width={16} height={16} />
      </Button>
      <Button variant="destructive" size="icon" className="h-9 w-9" onClick={onHangup} aria-label={tr("End call")} icon={null}>
        <PhoneDownIcon width={16} height={16} />
      </Button>
    </section>
  );
}
