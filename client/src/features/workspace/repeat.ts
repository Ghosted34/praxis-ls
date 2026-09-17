/**
 * Repeat — the client half of the RRULE contract (13840).
 *
 * The server (`src/modules/dashboard/workspace/recurrence.js`) is the authority
 * on what a rule MEANS and rejects what it does not implement; this file only
 * builds the five rules the picker offers and reads the canonical form back for
 * editing and for a sentence a person can read. It must therefore stay inside
 * the server's subset by construction — anything it could write that the server
 * would 422 is a bug, and `describeRule` falls back to a neutral sentence rather
 * than throwing for a rule it does not recognise (a row written by a future
 * client is not an error to the reader).
 *
 * Day-first: nothing here renders a bare date except through `dateFmt`, so an
 * "until 14/09/2027" reads day-first everywhere the product does.
 */
import { dateFmt } from "@/lib/format";

export type RepeatKind = "none" | "daily" | "weekly" | "monthly" | "yearly";

export type RepeatState = {
  kind: RepeatKind;
  /** Every Nth day/week/month/year. 1 is "every". */
  interval: number;
  /** 0 = Sunday … 6 = Saturday, for a weekly rule. */
  weekday: number | null;
  /** 1..31, for a monthly rule. Defaults to the due date's day. */
  monthDay: number | null;
  /** `YYYY-MM-DD` the series ends on, or null for "forever". */
  until: string | null;
};

export const REPEAT_KINDS: { value: RepeatKind; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

export const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const WEEKDAY_RRULE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Default the picker from the anchor date so "monthly" lands on its own day. */
export function repeatStateFromDue(dueIso: string | null): RepeatState {
  const d = dueIso ? new Date(dueIso) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return {
    kind: "none",
    interval: 1,
    weekday: safe.getDay(),
    monthDay: safe.getDate(),
    until: null,
  };
}

/**
 * The picker state as the stored RRULE, or null for "does not repeat".
 *
 * The shape mirrors what `recurrence.js#canonicalise` emits, so a rule this
 * builds round-trips unchanged.
 */
export function buildRule(state: RepeatState): string | null {
  if (state.kind === "none") return null;
  const freq = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" }[
    state.kind
  ];
  if (!freq) return null;
  const parts = [`FREQ=${freq}`];
  if (state.interval > 1) parts.push(`INTERVAL=${state.interval}`);
  if (state.kind === "weekly" && state.weekday !== null) {
    parts.push(`BYDAY=${WEEKDAY_RRULE[state.weekday]}`);
  }
  if (state.kind === "monthly" && state.monthDay !== null) {
    parts.push(`BYMONTHDAY=${state.monthDay}`);
  }
  if (state.until) parts.push(`UNTIL=${state.until.replace(/-/g, "")}`);
  return parts.join(";");
}

/** The stored rule back into picker state. Unrecognised rules give "none". */
export function parseRule(rule: string | null | undefined, dueIso: string | null): RepeatState {
  const base = repeatStateFromDue(dueIso);
  if (!rule) return { ...base, kind: "none" };
  const parts = rule.toUpperCase().replace(/^RRULE:/, "").split(";");
  const state = { ...base, kind: "none" as RepeatKind };
  let matched = false;
  for (const chunk of parts) {
    const [key, value] = chunk.split("=");
    if (key === "FREQ") {
      const kind = ({ DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" } as const)[
        value as "DAILY"
      ];
      if (kind) {
        state.kind = kind;
        matched = true;
      }
    } else if (key === "INTERVAL") {
      const n = Number(value);
      if (Number.isInteger(n) && n >= 1) state.interval = n;
    } else if (key === "BYDAY") {
      const i = WEEKDAY_RRULE.indexOf(value);
      if (i >= 0) state.weekday = i;
    } else if (key === "BYMONTHDAY") {
      const n = Number(value);
      if (Number.isInteger(n) && n >= 1 && n <= 31) state.monthDay = n;
    } else if (key === "UNTIL") {
      // `20270914` -> `2027-09-14`.
      const m = /^(\d{4})(\d{2})(\d{2})/.exec(value);
      if (m) state.until = `${m[1]}-${m[2]}-${m[3]}`;
    }
  }
  if (!matched) return { ...base, kind: "none" };
  return state;
}

/** A sentence for the card, the panel and the agenda. */
export function describeRule(rule: string | null | undefined): string | null {
  if (!rule) return null;
  const parts = rule.toUpperCase().replace(/^RRULE:/, "").split(";");
  const get = (k: string) => parts.find((p) => p.startsWith(`${k}=`))?.split("=")[1];
  const freq = get("FREQ");
  const interval = Number(get("INTERVAL") || "1");
  const every = interval > 1 ? `every ${interval} ` : "every ";
  let core: string | null = null;
  if (freq === "DAILY") core = `${every}day`;
  else if (freq === "WEEKLY") {
    const day = WEEKDAY_OPTIONS.find((w) => WEEKDAY_RRULE[w.value] === get("BYDAY"));
    core = day ? `${every}week on ${day.label}` : `${every}week`;
  } else if (freq === "MONTHLY") {
    const d = get("BYMONTHDAY");
    core = d ? `${every}month on the ${d}` : `${every}month`;
  } else if (freq === "YEARLY") core = `${every}year`;
  if (!core) return "Repeats";
  const until = get("UNTIL");
  if (until) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(until);
    if (m) core += ` until ${dateFmt(`${m[1]}-${m[2]}-${m[3]}`)}`;
  }
  return `Repeats ${core}`;
}
