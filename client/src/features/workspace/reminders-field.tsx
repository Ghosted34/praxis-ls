/**
 * The several-reminders editor — up to three rows, shared by the task and the
 * event dialog (13880).
 *
 * ── WHY ONE COMPONENT FOR TWO FORMS ────────────────────────────────────────
 *
 * The vocabulary, the cap and the two kinds of alarm are the same for a task
 * and for an event; only the anchor differs, and the form holds that in
 * `dueIso` the same way `<RepeatField>` does. Two editors would drift on the
 * first row one of them grows, and the drift shows up as "a task can remind
 * by email but an event cannot" — a bug nobody reports because it reads as a
 * missing feature.
 *
 * ── THE TWO KINDS ARE ONE QUESTION ─────────────────────────────────────────
 *
 * "1 hour before" and "Friday at 09:00" are answers to the same question —
 * when should this nudge fire — and belong in one field, not two. A row's
 * select holds the presets and the escape hatch ("pick a time"); choosing the
 * escape reveals the wall-clock field. The submit translates: a relative row
 * goes up as `reminder_minutes`, an absolute one as `remind_at`, and the two
 * never travel together (the API's refine says so too, but the user meets it
 * here first, as one select, not a 422).
 *
 * ── EMAIL IS THE AUTHOR'S OVERRIDE ─────────────────────────────────────────
 *
 * The per-row "email me too" tick is the author's override of the recipient's
 * email preference for THIS reminder, recorded on the row. It is opt-in on
 * purpose: an in-app nudge is the default, and email is asked for, not
 * assumed.
 *
 * Rows that have already fired (`reminder_sent_at` stamped) render as history
 * rather than as a live choice — editing the row replaces the set, which is
 * the write-side's re-arm contract.
 */
import { Field } from "@/components/ui/modal";
import { NativeSelect } from "@/components/ui/select";
import { DateTimeField } from "@/components/ui/datetime-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { RepeatScope } from "./api";
import { REMINDER_PRESETS } from "./labels";
import { CUSTOM, MAX_REMINDERS } from "./reminder-drafts";
import type { ReminderDraft } from "./reminder-drafts";
export type { ReminderDraft } from "./reminder-drafts";

/** The relatable presets, minus the "No reminder" option the row list itself
 *  answers. */
const WHEN_OPTIONS = REMINDER_PRESETS.filter((p) => p.value !== "");

export function RemindersField({
  rows,
  onChange,
  recurring,
  idPrefix,
}: {
  rows: ReminderDraft[];
  onChange: (rows: ReminderDraft[]) => void;
  /** Series-level scope is offered only when the record repeats. */
  recurring: boolean;
  idPrefix: string;
}) {
  const setRow = (i: number, patch: Partial<ReminderDraft>) =>
    onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => onChange(rows.filter((_, k) => k !== i));
  const addRow = () =>
    onChange([...rows, { when: "1440", at: "", email: false, scope: "this" }]);

  return (
    <Field
      label="Reminders"
      htmlFor={`${idPrefix}-reminder-0`}
      hint={`Up to ${MAX_REMINDERS} — before the date, or at a time you pick.`}
    >
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div
            key={i}
            className="space-y-2 rounded-md border border-border/60 p-2"
            aria-label={`Reminder ${i + 1}`}
          >
            <div className="flex items-start gap-2">
              <NativeSelect
                id={i === 0 ? `${idPrefix}-reminder-0` : undefined}
                aria-label={`Reminder ${i + 1} timing`}
                value={row.when}
                onChange={(e) => setRow(i, { when: e.target.value })}
              >
                <option value="" disabled>
                  Choose a time…
                </option>
                {WHEN_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
                <option value={CUSTOM}>At a time I pick…</option>
              </NativeSelect>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                aria-label={`Remove reminder ${i + 1}`}
                onClick={() => removeRow(i)}
              >
                Remove
              </Button>
            </div>
            {row.when === CUSTOM && (
              <DateTimeField value={row.at} onChange={(v) => setRow(i, { at: v })} />
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Checkbox
                checked={row.email}
                onCheckedChange={(v) => setRow(i, { email: v })}
                label="Also send by email"
              />
              {recurring && (
                <NativeSelect
                  aria-label={`Reminder ${i + 1} occurrences`}
                  value={row.scope}
                  onChange={(e) => setRow(i, { scope: e.target.value as RepeatScope })}
                  className="w-auto"
                >
                  <option value="this">Just this one</option>
                  <option value="series">Every occurrence</option>
                </NativeSelect>
              )}
              {row.sent && (
                <span className="micro">Already sent for this date</span>
              )}
            </div>
          </div>
        ))}
        {rows.length < MAX_REMINDERS && (
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            {rows.length ? "Add another reminder" : "Add a reminder"}
          </Button>
        )}
      </div>
    </Field>
  );
}
