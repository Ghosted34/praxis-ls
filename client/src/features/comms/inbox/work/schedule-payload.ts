/**
 * The scheduled-send choice, and the two fields it becomes on the wire (§9.3).
 *
 * ── WHY THIS IS NOT IN schedule.tsx ─────────────────────────────────────────
 *
 * `react-refresh/only-export-components` — a module that exports both a
 * component and a plain function loses fast refresh for the component, because
 * the refresh runtime cannot tell whether the non-component export changed in a
 * way that matters. The rule is a warning rather than an error and 53 files in
 * this codebase carry it, but `npm run lint` runs under `--max-warnings 112`
 * and that budget is a ratchet: it exists so the count comes down over time,
 * not so new work can spend the headroom left by old work.
 *
 * Splitting is also the better shape. This file is the SHAPE of a scheduled
 * send — one type and one pure total function over it — and it is what the
 * composer and the tests actually reach for. `schedule.tsx` is the picker that
 * happens to produce one.
 *
 * ── EXACTLY ONE FIELD, OR NEITHER ───────────────────────────────────────────
 *
 * Never both. Scheduling and undo are the same mechanism server-side — a delay
 * on the queue row — so two fields arriving together would be two answers to
 * one question, and the server would have to pick. It does not have to, because
 * this cannot express that.
 */

export type ScheduleChoice =
  | { kind: "NOW" }
  | { kind: "AT"; iso: string }
  | { kind: "MORNING" };

/** The two fields the send payload carries. Exactly one of them, or neither. */
export function schedulePayload(v: ScheduleChoice): {
  send_at?: string;
  send_in_recipient_morning?: boolean;
} {
  if (v.kind === "AT") return { send_at: v.iso };
  if (v.kind === "MORNING") return { send_in_recipient_morning: true };
  return {};
}
