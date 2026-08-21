/**
 * SCHEDULED SEND (§9.3).
 *
 * Two shapes, and deliberately no third:
 *
 *   send_at                    an instant the operator chose.
 *   send_in_recipient_morning  09:00 on the recipient's clock.
 *
 * ── WHY THERE IS NO "BEST TIME TO SEND" ─────────────────────────────────────
 *
 * §9.3 MUST NOT offer one. Q32 removed the open-rate tracking that would be
 * needed to know it, so a "best time" button would be a number with nothing
 * behind it — the kind of feature that looks like intelligence and is a
 * hardcoded 10am. There is no third option to offer and no amount of
 * client-side wishing that can invent one.
 *
 * ── THE RECIPIENT'S MORNING NEEDS A RECIPIENT TIMEZONE ──────────────────────
 *
 * The server refuses with NO_RECIPIENT_TIMEZONE rather than guessing when the
 * party has none on file. Guessing means a message meant for a Douala morning
 * arriving at 3am, and the operator never finding out. This component says so
 * up front so the refusal is not a surprise at send.
 *
 * ── SCHEDULING AND UNDO ARE THE SAME MECHANISM ──────────────────────────────
 *
 * Both are a delay on the queue row, so exactly ONE of them decides the release
 * time. A scheduled message reports `undo_seconds: 0` — it has a whole schedule
 * to be cancelled within instead of a twenty-second countdown — and the
 * composer must not draw a toast for it.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// The choice type and the payload function live in `schedule-payload.ts` — a
// module exporting both a component and a plain function loses fast refresh for
// the component. See that file's header.
import type { ScheduleChoice } from "./schedule-payload";


/** Local `datetime-local` value → an ISO instant with the browser's offset. */
const toIso = (v: string) => (v ? new Date(v).toISOString() : "");

export function SchedulePicker({
  value,
  onChange,
  recipientTimezone,
}: {
  value: ScheduleChoice;
  onChange: (v: ScheduleChoice) => void;
  /** From the bound party. `null` means the morning option cannot work. */
  recipientTimezone?: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [at, setAt] = React.useState("");

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {value.kind !== "NOW" && (
          <span className="text-xs text-muted-foreground">
            {value.kind === "MORNING"
              ? `Going out at 09:00 in ${recipientTimezone || "their timezone"}`
              : `Going out ${new Date(value.iso).toLocaleString()}`}
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          {value.kind === "NOW" ? "Send later" : "Change"}
        </Button>
        {value.kind !== "NOW" && (
          <Button size="sm" variant="ghost" onClick={() => onChange({ kind: "NOW" })}>
            Send now instead
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card/40 px-3 py-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-muted-foreground">At a time</span>
          <Input
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            aria-label="Send at"
            className="mt-0.5 h-8 text-xs"
          />
        </label>
        <Button
          size="sm"
          disabled={!at}
          onClick={() => { onChange({ kind: "AT", iso: toIso(at) }); setOpen(false); }}
        >
          Schedule
        </Button>
      </div>

      <div>
        {/* Offered whether or not we know the timezone yet, and NOT disabled:
            the composer often does not have the party's record loaded, and a
            greyed button would claim a fact we have not checked. The server
            resolves it at send and refuses with NO_RECIPIENT_TIMEZONE rather
            than guessing — a guess means a message meant for a Douala morning
            arriving at 3am and nobody finding out. */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => { onChange({ kind: "MORNING" }); setOpen(false); }}
        >
          Their morning (09:00)
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">
          {recipientTimezone
            ? `09:00 in ${recipientTimezone}, on their next working morning.`
            : "09:00 where they are. If we have no timezone on file for them, the send is refused and says so — we will not guess one."}
        </p>
      </div>

      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
