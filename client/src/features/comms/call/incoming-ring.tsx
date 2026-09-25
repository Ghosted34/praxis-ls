/**
 * The incoming call (calls audit PR-6; O4, F1, F2, F6, F9, G5).
 *
 * A solid card, never a layer over the app: top-right on a desktop, so the
 * screen the person is working on stays usable, and top-centre on a phone,
 * where it can open to a full solid screen. It says who is calling, how long
 * it has rung, whether the call will be recorded and by whom its audio is
 * processed, and offers Decline, Answer and (when the call would be recorded)
 * Answer without recording.
 *
 * The 60-second window is the server's (the ring's own clock job ends the
 * row); the time shown here is that same window, rendered. In the caller's
 * own conversation the thread's banner replaces this card (comms-live), so
 * there is only ever one Answer button.
 */
import * as React from "react";
import { tr, tv } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PhoneIcon, PhoneDownIcon, ExpandIcon, MinimizeIcon } from "@/components/ui/icons";
import type { CallProcessing } from "@/lib/smartcomm-api";
import { processorsSentence } from "./call-capabilities";
import { RecordingNotice } from "./call-parts";
import { RING_WINDOW_S, ringingFor } from "./call-time";

type Props = {
  name: string | null;
  secondsLeft: number;
  /** Would this call be recorded if answered normally (the ring payload). */
  recordingEnabled?: boolean;
  processing?: CallProcessing | null;
  onAccept: () => void;
  onAcceptWithoutRecording?: () => void;
  onDecline: () => void;
  /** The ring tone is silent until the page is tapped (autoplay rules). */
  soundBlocked?: boolean;
  onEnableSound?: () => void;
};

export function IncomingRing({
  name, secondsLeft, recordingEnabled = false, processing = null,
  onAccept, onAcceptWithoutRecording, onDecline, soundBlocked = false, onEnableSound,
}: Props) {
  const [full, setFull] = React.useState(false);
  const who = name || tr("Someone");
  const titleId = React.useId();
  return (
    <section
      // An incoming call asks for an answer now: alertdialog, announced as
      // soon as it appears. Modal only when it has taken the whole screen.
      role="alertdialog"
      aria-modal={full ? "true" : "false"}
      aria-labelledby={titleId}
      data-call-surface="ring"
      className={cn(
        "fixed z-[70] flex flex-col gap-3 border border-border bg-background text-foreground shadow-[var(--shadow-l)]",
        full
          ? "inset-0 justify-center rounded-none p-6 md:inset-auto md:right-4 md:top-4 md:w-[380px] md:rounded-2xl md:p-4"
          : "inset-x-2 top-2 rounded-2xl p-4 md:inset-x-auto md:right-4 md:top-4 md:w-[380px]",
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar name={who} />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-base font-semibold">{who}</h2>
          <p className="text-xs text-muted-foreground">
            {tr("Incoming voice call")} · {tv("ringing {{time}}", { time: ringingFor(RING_WINDOW_S - secondsLeft) })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 md:hidden"
          onClick={() => setFull((v) => !v)}
          aria-label={full ? tr("Smaller") : tr("Full screen")}
          icon={null}
        >
          {full ? <MinimizeIcon width={16} height={16} /> : <ExpandIcon width={16} height={16} />}
        </Button>
      </div>

      {recordingEnabled && (
        <RecordingNotice future detail={processorsSentence(processing)} />
      )}

      {soundBlocked && (
        <Button variant="outline" size="sm" onClick={onEnableSound} icon={null} className="self-start">
          {tr("Tap to enable ring sound")}
        </Button>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="destructive" onClick={onDecline} icon={<PhoneDownIcon width={16} height={16} />}>
          {tr("Decline")}
        </Button>
        <Button variant="confirm" onClick={onAccept} icon={<PhoneIcon width={16} height={16} />}>
          {tr("Answer")}
        </Button>
      </div>
      {recordingEnabled && onAcceptWithoutRecording && (
        <Button variant="outline" size="sm" onClick={onAcceptWithoutRecording} icon={null}>
          {tr("Answer without recording")}
        </Button>
      )}
    </section>
  );
}
