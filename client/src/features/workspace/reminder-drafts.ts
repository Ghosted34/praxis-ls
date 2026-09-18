/**
 * The several-reminders drafting helpers — the form-side shapers of 13880,
 * and nothing but.
 *
 * ── WHY A MODULE OF ITS OWN ────────────────────────────────────────────────
 *
 * These functions are the contract the dialog and the tests share with the
 * server: which string the NativeSelect holds becomes which API field, and
 * "relative OR absolute, never both, never neither" is enforced here so the
 * server's 400 is a belt, not the lesson. Pure modules carry no component,
 * so nothing here is subject to the fast-refresh one-export rule and the
 * shape is importable without mounting a single node.
 */
import type { Reminder, ReminderInput, RepeatScope } from "./api";
import { REMINDER_PRESETS } from "./labels";
import { tenantWallInput } from "./time";

/** The most reminders one record carries. The API's own cap, surfaced as a
 *  form rule rather than a 422, is still the truth to hold here. */
export const MAX_REMINDERS = 3;

/** The escape hatch's sentinel, distinct from every preset's value. */
export const CUSTOM = "custom";

/** One row as the form holds it — a string because the presets ride a
 *  NativeSelect, which speaks strings. */
export type ReminderDraft = {
  /** A preset's value ("60"), the escape hatch ("custom"), or "" for a row the
   *  user has not decided yet. */
  when: string;
  /** The absolute instant when `when === "custom"` — `YYYY-MM-DDTHH:mm` wall. */
  at: string;
  email: boolean;
  scope: RepeatScope;
  /** A row that has already fired is shown as history, not offered as a choice. */
  sent?: boolean;
};

/** Server rows → form rows, in ordinal order. The tenant wall-input is needed
 *  only for rows pinned at an exact instant. */
export function toReminderDrafts(rows: Reminder[] | undefined, timeZone: string): ReminderDraft[] {
  return (rows ?? []).map((r) => ({
    when: r.reminder_minutes != null ? String(r.reminder_minutes) : CUSTOM,
    at: r.remind_at ? tenantWallInput(r.remind_at, timeZone) : "",
    email: r.email === true,
    scope: r.scope === "series" ? "series" : "this",
    sent: Boolean(r.reminder_sent_at),
  }));
}

/** 13810's one-column shape → one draft row, for records read before the
 *  reminders plural arrived. */
export function fromLegacyReminder(
  reminderMinutes: number | null | undefined,
  remindAt: string | null | undefined,
  timeZone: string,
): ReminderDraft[] {
  if (reminderMinutes != null) {
    return [{ when: String(reminderMinutes), at: "", email: false, scope: "this" }];
  }
  if (remindAt) {
    return [{ when: CUSTOM, at: tenantWallInput(remindAt, timeZone), email: false, scope: "this" }];
  }
  return [];
}

/**
 * Form rows → the API's `reminders` list, or null when the set screams — one
 * error sentence for the whole field, because "row 2 has no time" is form
 * work, not a server round trip.
 */
export function draftsToInput(rows: ReminderDraft[]): { input: ReminderInput[] } | { error: string } {
  const out: ReminderInput[] = [];
  // Titles for the label column: the preset's own words, so "the day before"
  // round-trips as prose rather than as "1440".
  const labelFor = (when: string) =>
    REMINDER_PRESETS.find((p) => p.value === when)?.label ?? null;
  for (const [i, row] of rows.entries()) {
    if (row.when === "") return { error: `Reminder ${i + 1} has no time chosen.` };
    if (row.when === CUSTOM && !row.at) {
      return { error: `Reminder ${i + 1} needs a date and a time.` };
    }
    out.push(
      row.when === CUSTOM
        ? { remind_at: row.at, reminder_minutes: null, email: row.email, scope: row.scope, label: null }
        : {
            reminder_minutes: Number(row.when),
            remind_at: null,
            email: row.email,
            scope: row.scope,
            label: labelFor(row.when),
          },
    );
  }
  return { input: out };
}

