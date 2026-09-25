/**
 * The call, inside the conversation it belongs to (calls audit PR-6; O4).
 *
 * While the caller's conversation is open, this strip at the top of the thread
 * replaces the ring card, so there is only ever one Answer button; once
 * answered it becomes the live-call strip (name, clock, mute, open the call,
 * hang up), and the docked bar steps aside. "Open the call" shows the full
 * call screen (quality, noise filter, the recording notice); while it is open
 * the strip steps aside in turn, so End call is never on screen twice
 * (call-view.ts). It sits in the thread's layout flow.
 */
import { tr, tv } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { PhoneIcon, PhoneDownIcon, MicIcon, MicOffIcon, ExpandIcon } from "@/components/ui/icons";
import { useCall, answer, decline, hangup, setMuted } from "./call-session";
import { useCallProcessing, processorsSentence } from "./call-capabilities";
import { RecordingNotice } from "./call-parts";
import { fmtClock, ringingFor, RING_WINDOW_S } from "./call-time";
import { useCallView, setCallView } from "./call-view";

/** The strip for `groupId`'s call, or nothing when no call is on it. */
export function ThreadCallStrip({ groupId }: { groupId: string | null | undefined }) {
  const call = useCall();
  const live = !!groupId && call.call?.group_id === groupId
    && call.phase !== "idle" && call.phase !== "ended";
  const processing = useCallProcessing(live && call.recordingEnabled);
  const view = useCallView();
  if (!live) return null;
  const who = call.peerName || tr("Someone");

  if (call.phase === "incoming") {
    return (
      <section
        aria-label={tv("Incoming call from {{name}}", { name: who })}
        data-call-surface="thread-ring"
        className="flex flex-col gap-2 border-b border-border bg-card px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">{who}</span>{" "}
            <span className="text-muted-foreground">
              {tr("is calling")} · {tv("ringing {{time}}", { time: ringingFor(RING_WINDOW_S - call.ringSecondsLeft) })}
            </span>
          </p>
          <Button variant="destructive" size="sm" onClick={() => void decline()} icon={<PhoneDownIcon width={14} height={14} />}>
            {tr("Decline")}
          </Button>
          <Button variant="confirm" size="sm" onClick={() => void answer()} icon={<PhoneIcon width={14} height={14} />}>
            {tr("Answer")}
          </Button>
          {call.recordingEnabled && (
            <Button variant="outline" size="sm" onClick={() => void answer({ record: false })} icon={null}>
              {tr("Answer without recording")}
            </Button>
          )}
        </div>
        {call.recordingEnabled && <RecordingNotice future compact detail={processorsSentence(processing)} />}
      </section>
    );
  }

  // The full call screen is open: it carries the controls.
  if (view === "full") return null;
  const status = call.phase === "in_call"
    ? fmtClock(call.elapsedS)
    : call.phase === "connecting" ? tr("Connecting…") : tr("Calling…");
  return (
    <section
      aria-label={`${tr("Voice call")} — ${who}`}
      data-call-surface="thread-live"
      className="flex items-center gap-2 border-b border-border bg-card px-4 py-2"
    >
      {call.recordingEnabled && (
        <span className="inline-block h-2 w-2 flex-none rounded-full bg-destructive" title={tr("Recorded")}>
          <span className="sr-only">{tr("Recorded")}</span>
        </span>
      )}
      <p className="min-w-0 flex-1 truncate text-sm">
        <span className="font-semibold">{who}</span>{" "}
        <span className="font-mono tabular-nums text-muted-foreground">{status}</span>
      </p>
      {call.phase === "in_call" && (
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMuted(!call.muted)}
          aria-pressed={call.muted} aria-label={call.muted ? tr("Unmute") : tr("Mute")} icon={null}>
          {call.muted ? <MicOffIcon width={15} height={15} /> : <MicIcon width={15} height={15} />}
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCallView("full")}
        aria-label={tr("Open the call")} icon={null}>
        <ExpandIcon width={15} height={15} />
      </Button>
      <Button variant="destructive" size="sm" onClick={() => void hangup()} icon={<PhoneDownIcon width={14} height={14} />}>
        {tr("End call")}
      </Button>
    </section>
  );
}
