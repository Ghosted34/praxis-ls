/**
 * DraftBanner — "you were part-way through this last time; want it back?"
 *
 * The visible half of `lib/form-draft.ts`. Deliberately an OFFER, never an
 * automatic restore: silently repopulating a form with values from an earlier
 * sitting is how somebody edits the wrong record, and in a system of record
 * that is worse than retyping. The user says yes.
 *
 * It also gives the user a way to say NO and mean it — `onDiscard` deletes the
 * stored draft rather than merely hiding this. A prompt that reappears on every
 * visit because dismissing it did nothing is a prompt people learn to click
 * past without reading.
 *
 * @example
 * const draft = useFormDraft({ key: `entity:${id ?? "new"}`, values: v, label: "Corporate entity" });
 * {draft.pending && (
 *   <DraftBanner
 *     savedAt={draft.pending.savedAt}
 *     onRestore={() => { const vals = draft.restore(); if (vals) setV(vals); }}
 *     onDiscard={draft.discard}
 *   />
 * )}
 */
import { Button } from "@/components/ui/button";

/** "just now" / "14:02" / "Tuesday 14:02" — as much precision as is useful. */
function whenLabel(ts: number): string {
  const age = Date.now() - ts;
  if (age < 90_000) return "moments ago";
  const d = new Date(ts);
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (age < 12 * 60 * 60 * 1000) return `at ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "long" })} at ${time}`;
}

export function DraftBanner({
  savedAt,
  onRestore,
  onDiscard,
  /** Names what was in progress, when the form itself does not make it obvious. */
  what,
}: {
  savedAt: number;
  onRestore: () => void;
  onDiscard: () => void;
  what?: string;
}) {
  return (
    // `status`, not `alert`: this is good news arriving at a calm moment, and
    // interrupting a screen reader mid-sentence to deliver it would be rude.
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-brand-blue/40 bg-brand-blue/10 p-3 text-sm"
    >
      <p className="min-w-0 flex-1 text-foreground">
        You have unsaved {what ? `${what.toLowerCase()} ` : ""}changes from{" "}
        {whenLabel(savedAt)}.
      </p>
      <div className="flex gap-2">
        {/* `type="button"` is load-bearing, not boilerplate. This banner renders
            INSIDE the <form> it rescues, and `Button` sets no default type — so
            without it a browser treats both as submit buttons and "Restore
            them" would restore the values and immediately submit the form with
            the pre-restore ones. */}
        <Button type="button" size="sm" icon={null} onClick={onRestore}>
          Restore them
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          icon={null}
          onClick={onDiscard}
        >
          Start fresh
        </Button>
      </div>
    </div>
  );
}
