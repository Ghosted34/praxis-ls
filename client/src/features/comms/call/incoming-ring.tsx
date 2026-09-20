/**
 * The incoming-call ring (Smart Comms PR-1).
 *
 * A ring is a decision with a deadline: answer or it's over. The 60-second
 * window is the server's (the sweep ends the row at 60 s whether or not this
 * tab is awake), and the countdown shown here is that same clock rendered —
 * not a second, independent timer the UI keeps in its own head. When it hits
 * zero the socket delivers the terminal state and this surface unmounts; the
 * "missed call" toast does the rest.
 *
 * "Do our utmost best to always have it ring" (the locked Q6): while this
 * tab is OPEN this surface IS the ring (plus the repeated tone, which
 * comms-live owns). Backgrounded, the Notification tier fires. Closed, PR-3's
 * web-push tier takes over — and beyond that, presence is the honest floor:
 * a dot that says "not here, last seen X", never a fake ring.
 */
import { tr, tv } from "@/lib/i18n";
import { PhoneIcon, PhoneDownIcon } from "@/components/ui/icons";

function fmt(s: number): string {
  return `0:${String(Math.max(0, s)).padStart(2, "0")}`;
}

type Props = {
  name: string | null;
  secondsLeft: number;
  onAccept: () => void;
  onDecline: () => void;
};

export function IncomingRing({ name, secondsLeft, onAccept, onDecline }: Props) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={name ? tv("Incoming call from {{name}}", { name }) : tr("Voice call")}
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 bg-[rgb(var(--background)/0.97)] px-6 backdrop-blur-sm animate-fade-in"
    >
      <PhoneIcon width={44} height={44} className="text-brand-blue-ink" />
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-xl font-semibold text-foreground">{name || "—"}</p>
        <p className="text-sm text-muted-foreground">{tv("Incoming call from {{name}}", { name: name || "" })}</p>
      </div>
      {/* The shared 60 s window, rendered. */}
      <p className="font-mono text-lg tabular-nums text-muted-foreground" role="timer" aria-label={fmt(secondsLeft)}>
        {fmt(secondsLeft)}
      </p>
      <div className="flex items-center gap-10">
        <button
          type="button"
          onClick={onDecline}
          aria-label={tr("Decline")}
          className="flex flex-col items-center gap-2"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[rgb(var(--bad))] text-white shadow-[var(--shadow-l)] transition-transform active:scale-95">
            <PhoneDownIcon width={28} height={28} />
          </span>
          <span className="text-xs text-muted-foreground">{tr("Decline")}</span>
        </button>
        <button
          type="button"
          onClick={onAccept}
          aria-label={tr("Answer")}
          className="flex flex-col items-center gap-2"
        >
          <span className="flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-[rgb(var(--ok))] text-white shadow-[var(--shadow-l)] transition-transform active:scale-95">
            <PhoneIcon width={28} height={28} />
          </span>
          <span className="text-xs text-muted-foreground">{tr("Answer")}</span>
        </button>
      </div>
    </div>
  );
}
