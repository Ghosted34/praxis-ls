/**
 * The attendance period chips and their bounds.
 *
 * A MODULE OF ITS OWN, not a helper inside the widget: a file that exports both
 * components and functions loses fast refresh for the whole file (the
 * `react-refresh/only-export-components` rule), and this is the one piece of the
 * history widget that is pure, worth testing on its own, and shared by the chip
 * row and the initial window.
 */

export type Period = "7d" | "month" | "quarter" | "year" | "custom";

export const PERIODS: { key: Period; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
  { key: "custom", label: "Custom" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The bounds of a period, in UTC calendar dates.
 *
 * ── WHY EVERY PERIOD ENDS TODAY AND NOT YESTERDAY ──────────────────────────
 *
 * Reconciliation runs on completed days, so today usually has no row yet. The
 * window still INCLUDES today, because the punches sheet and the heatmap both
 * have something true to say about it — and a period called "7 days" that
 * silently means the seven before yesterday is a period nobody can reconcile
 * with their own memory.
 *
 * `month`, `quarter` and `year` are TO DATE rather than whole: on 3 August, the
 * month is 1–3 August. A whole-month default would open on a window that is
 * mostly future, which reads as a company that stopped turning up.
 *
 * The widest of these — `year` on 31 December — is 365 days, inside the API's
 * 366-day cap. That is the relationship worth keeping: the chips can never
 * offer a window the validator refuses.
 *
 * UTC throughout, matching `lib/format`'s handling of a Postgres `date`: these
 * are calendar dates the server compares against `work_date`, not instants.
 */
export function periodRange(period: Period, today: Date = new Date()): { from: string; to: string } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const to = iso(today);
  if (period === "month") return { from: iso(new Date(Date.UTC(y, m, 1))), to };
  if (period === "quarter") return { from: iso(new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))), to };
  if (period === "year") return { from: iso(new Date(Date.UTC(y, 0, 1))), to };
  // 7d (and the seed for `custom`): the last seven days INCLUDING today, so it
  // is seven cells on the heatmap and not eight.
  return { from: iso(new Date(today.getTime() - 6 * 86400000)), to };
}
