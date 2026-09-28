/**
 * Time, the way the portal says it: "Today", "Tomorrow", "in 3 days", "14:05".
 *
 * Every word here comes from `Intl` in the reader's language, not from the
 * dictionary — "aujourd’hui" and "dans 3 jours" are the platform's own, correct
 * to the apostrophe, at no bundle cost. Anything further than a week out falls
 * back to the calendar date, which `lib/format.ts` prints day-first.
 */
import { currentLocale } from "@/lib/i18n";
import { dateFmt } from "@/lib/format";

const CALENDAR = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A `date` column is a calendar day, not an instant: midnight LOCAL, never UTC. */
export function toDate(v: string | Date): Date | null {
  if (v instanceof Date) return v;
  const m = CALENDAR.exec(v);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Whole days from today to `v`: 0 today, 1 tomorrow, -1 yesterday. */
export function daysFromToday(v: string | Date | null | undefined): number | null {
  if (!v) return null;
  const d = toDate(v);
  if (!d) return null;
  return Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
}

const cap = (s: string) => (s ? s.charAt(0).toLocaleUpperCase(currentLocale()) + s.slice(1) : s);
const rtf = () => new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" });

/** "today" / "tomorrow" / "in 3 days" — to sit inside a phrase ("Due {{when}}")
 *  — else the date. */
export function relDay(v: string | Date | null | undefined, window = 7): string {
  const n = daysFromToday(v);
  if (n === null) return "—";
  if (Math.abs(n) <= window) return rtf().format(n, "day");
  return dateFmt(v);
}

/** The same, standing alone: "Tomorrow". */
export const relDayTitle = (v: string | Date | null | undefined, window = 7): string => cap(relDay(v, window));

/** The marker between days in a conversation: Today, Yesterday, then dates. */
export function dayLabel(v: string): string {
  const n = daysFromToday(v);
  if (n === 0 || n === -1) return cap(rtf().format(n, "day"));
  return dateFmt(v);
}

/** 24-hour clock in the reader's locale — en-GB or fr-FR, never the machine's. */
export function timeOf(v: string): string {
  const d = toDate(v);
  if (!d) return "";
  return d.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
}

/** A time or a day, whichever is shorter and still unambiguous. */
export function whenShort(v: string | null | undefined): string {
  if (!v) return "—";
  const n = daysFromToday(v);
  if (n === 0) return timeOf(v);
  return relDay(v);
}

/** Which greeting the hour calls for. */
export function partOfDay(now = new Date()): "morning" | "afternoon" | "evening" {
  const h = now.getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}
