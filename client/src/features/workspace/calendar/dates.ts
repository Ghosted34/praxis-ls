/**
 * The calendar's date arithmetic, apart from the components that draw it.
 *
 * Split out because `react-refresh/only-export-components` is right about the
 * consequence even though it reads as pedantry: a file exporting both a
 * component and helpers cannot be hot-swapped without a full reload, so
 * editing one chip's padding costs you the state of the whole screen. These
 * two functions are also exactly the part worth unit-testing on their own, and
 * a test cannot import from a component file without dragging React in.
 */

/** `YYYY-MM-DD` in LOCAL time.
 *
 *  Deliberately not `toISOString().slice(0, 10)`: that is the UTC date, and at
 *  23:30 in Douala it is tomorrow — which would file an evening appointment
 *  under the following day and leave the day it belongs on looking free. */
export function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** How many cells a month grid draws: six weeks, always.
 *
 *  A 31-day month starting on a Saturday needs six, and drawing five in the
 *  months that fit would make the page change height every time the user
 *  pressed "next". */
const CELLS = 42;

/** The 42 days a month view shows, starting on the Sunday on or before the 1st. */
export function monthCells(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from(
    { length: CELLS },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
