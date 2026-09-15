/**
 * The pin's date arithmetic.
 *
 * Its own module rather than living beside `PinDialog`, because a file that
 * exports both a component and plain functions breaks Fast Refresh — the
 * `react-refresh/only-export-components` rule says exactly this and names the
 * remedy. Two consumers (the list and the editor) and no component, so there is
 * nothing here to refresh.
 */

/** `<input type="date">` speaks `YYYY-MM-DD` in LOCAL time; the API wants an
 *  instant. End of the chosen day, so "pinned until the 4th" includes the 4th —
 *  a pin that vanished at midnight on the morning of its own expiry date would
 *  be a day short of what the tenant asked for. */
export const endOfDayIso = (day: string): string | null => {
  if (!day) return null;
  const d = new Date(`${day}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Tomorrow, as the date input's floor. The server refuses a past date
 *  (PIN_EXPIRED); saying so in the control is cheaper than saying it in a 422. */
export const tomorrow = (): string =>
  new Date(Date.now() + 86400e3).toISOString().slice(0, 10);

export function fmtDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}
