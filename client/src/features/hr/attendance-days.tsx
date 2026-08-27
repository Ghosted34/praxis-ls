/**
 * Reconciled days (0697) — the attendance month, and the money on it.
 *
 * ── WHY THIS IS A SEPARATE VIEW FROM THE LOG ──────────────────────────────
 *
 * The log is punches: it answers "who badged in, where, from what device". This
 * answers a different question — "what did this month cost, and is any of it
 * wrong?" — over a window rather than a day, because a lateness pattern is
 * invisible one day at a time and that is the only way anybody spots it.
 *
 * ── THE HONEST EMPTY STATE ────────────────────────────────────────────────
 *
 * Reconciliation runs on completed days, so today is never in here. A screen
 * that showed an empty table would read as "nobody was late", which is the one
 * wrong answer. When the window has no rows it says the days have not been
 * reconciled yet and offers to run one.
 *
 * Desktop-first and dense: a fixed header over a scrolling body, so a month of
 * a 30-person team is one screen with the totals always visible rather than a
 * page you scroll away from.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";

const STATUS_TONE: Record<string, Tone> = {
  PRESENT: "ok",
  LATE: "warn",
  ABSENT: "bad",
  ON_LEAVE: "blue",
  HOLIDAY: "mute",
  WEEKEND: "mute",
  OFF: "mute",
};

const num = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The month to date, which is the window a manager actually reviews. */
function defaultWindow() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // Yesterday: today has not been reconciled, so asking for it only produces a
  // gap at the bottom of the table.
  const to = new Date(now.getTime() - 86400000);
  return { from: iso(from), to: iso(to < from ? from : to) };
}

/** The waive dialog. EXPORTED because the history widget (PR2) raises the same
 *  decision from its own rows: waiving moves money off a payslip, and a second
 *  dialog would be a second wording of the one thing that must read the same
 *  everywhere it is offered. */
export function WaiveModal({
  day,
  onClose,
  onSaved,
}: {
  day: api.AttendanceDay;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [why, setWhy] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.justifyDay(day.attendance_day_id, { justified: true, justification: why });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Waive this day"
      description={`${day.employee_name || "This employee"} — ${dateFmt(day.work_date)}`}
    >
      <form className="space-y-4" onSubmit={submit}>
        {/* The figure is kept, not erased — which is what makes the waiver
            reversible and its cost visible. Saying so here stops "waive"
            reading as "delete". */}
        <Callout tone="info" title={`${money(day.deduction_amount)} will not be deducted`}>
          The amount stays on the record so this can be reversed, and so the cost
          of waivers is visible. Payroll ignores waived days.
        </Callout>
        <Field label="Why" required hint="The employee sees this on their own record.">
          <Input
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="Traffic on the Douala–Bonabéri bridge, confirmed by two colleagues"
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!why.trim() || busy}>
            Waive
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AttendanceDaysView() {
  const [win, setWin] = React.useState(defaultWindow);
  const [waiving, setWaiving] = React.useState<api.AttendanceDay | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [onlyCharged, setOnlyCharged] = React.useState(false);

  const q = useResource(() => api.attendanceDays(win), [win.from, win.to]);
  const rows = React.useMemo(() => {
    const all = q.data || [];
    return onlyCharged ? all.filter((d) => num(d.deduction_amount) > 0) : all;
  }, [q.data, onlyCharged]);

  const totals = React.useMemo(() => {
    const all = q.data || [];
    return {
      charged: all.filter((d) => num(d.deduction_amount) > 0 && !d.justified)
        .reduce((n, d) => n + num(d.deduction_amount), 0),
      waived: all.filter((d) => d.justified).reduce((n, d) => n + num(d.deduction_amount), 0),
      late: all.filter((d) => d.status === "LATE").length,
      absent: all.filter((d) => d.status === "ABSENT").length,
    };
  }, [q.data]);

  async function uphold(day: api.AttendanceDay) {
    setBusy(day.attendance_day_id);
    setError(null);
    try {
      await api.justifyDay(day.attendance_day_id, { justified: false });
      q.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function reconcile() {
    setBusy("reconcile");
    setError(null);
    try {
      await api.runReconcile(win.to);
      q.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* One dense control row: window, filter and the totals that make the
          window worth looking at, all above the fold on a laptop. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="micro">{tr("From")}</span>
            <Input
              type="date"
              value={win.from}
              onChange={(e) => setWin((w) => ({ ...w, from: e.target.value }))}
              className="w-auto"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="micro">{tr("To")}</span>
            <Input
              type="date"
              value={win.to}
              onChange={(e) => setWin((w) => ({ ...w, to: e.target.value }))}
              className="w-auto"
            />
          </label>
          <button
            type="button"
            onClick={() => setOnlyCharged((v) => !v)}
            className={cn("chip", onlyCharged && "on")}
          >
            Charged only
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-muted-foreground">
            Late <span className="num font-semibold text-foreground">{totals.late}</span>
          </span>
          <span className="text-muted-foreground">
            Absent <span className="num font-semibold text-foreground">{totals.absent}</span>
          </span>
          <span className="text-muted-foreground">
            Deducted{" "}
            <span className="num font-semibold text-[rgb(var(--bad))]">{money(totals.charged)}</span>
          </span>
          {totals.waived > 0 && (
            <span className="text-muted-foreground">
              Waived <span className="num font-semibold">{money(totals.waived)}</span>
            </span>
          )}
        </div>
      </div>

      {error && <ErrorState message={error} />}
      {q.error ? (
        <ErrorState message={q.error} />
      ) : rows.length === 0 && !q.loading ? (
        <EmptyState
          title={onlyCharged ? "Nothing charged in this window" : "These days have not been reconciled"}
          hint={
            onlyCharged
              ? "No lateness or absence carried a deduction."
              : "Reconciliation runs overnight on completed days. Run it now to see this window."
          }
          action={
            onlyCharged ? undefined : (
              <Button loading={busy === "reconcile"} onClick={reconcile}>
                Reconcile {dateFmt(win.to)}
              </Button>
            )
          }
        />
      ) : (
        <div className="lux-card overflow-hidden">
          {/* Scrolls inside its own box so the totals above stay put — the
              point of the density pass: more rows visible, less page scroll. */}
          <div className="max-h-[62vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[rgb(var(--surface))]">
                <tr className="border-b text-left">
                  <th className="whitespace-nowrap px-3 py-2 font-semibold uppercase text-muted-foreground">{tr("Date")}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold uppercase text-muted-foreground">{tr("Employee")}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold uppercase text-muted-foreground">{tr("Status")}</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-semibold uppercase text-muted-foreground">Late</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-semibold uppercase text-muted-foreground">{tr("Deduction")}</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold uppercase text-muted-foreground">{tr("Rule")}</th>
                  <th className="px-3 py-2">
                    <span className="sr-only">{tr("Actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.attendance_day_id} className="border-b last:border-0">
                    <td className="num whitespace-nowrap px-3 py-1.5 text-muted-foreground">{dateFmt(d.work_date)}</td>
                    <td className="px-3 py-1.5 font-medium text-foreground">{d.employee_name || "—"}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        {/* The RAW status goes to Pill, which sentence-cases an
                            enum through the shared `enumLabel`. Pre-splitting
                            the underscore here defeated that: `enumLabel` only
                            recognises `ON_LEAVE`, so "ON LEAVE" arrived already
                            spaced and came back out unchanged — this table
                            printed "ON LEAVE" where the history table, one tab
                            away and reading the same rows, printed "On leave".
                            Two adjacent screens shouting a status at different
                            volumes is the kind of thing people read as two
                            different states. */}
                        <Pill tone={STATUS_TONE[d.status] || "mute"}>{d.status}</Pill>
                        {d.justified && <Pill tone="mute">{tr("Waived")}</Pill>}
                      </div>
                    </td>
                    <td className="num whitespace-nowrap px-3 py-1.5 text-right text-muted-foreground">
                      {d.minutes_late > 0 ? `${d.minutes_late} ${tr("min")}` : "—"}
                    </td>
                    <td
                      className={cn(
                        "num whitespace-nowrap px-3 py-1.5 text-right",
                        num(d.deduction_amount) > 0 && !d.justified
                          ? "font-semibold text-[rgb(var(--bad))]"
                          : "text-muted-foreground",
                      )}
                    >
                      {num(d.deduction_amount) > 0 ? money(d.deduction_amount) : "—"}
                    </td>
                    {/* The clause behind the charge. An employee who can trace a
                        deduction to the handbook is looking at a rule; one who
                        cannot is looking at a surprise. */}
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">
                      {d.rule_name || "—"}
                      {d.sop_title && <span className="block opacity-70">{d.sop_title}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      {num(d.deduction_amount) > 0 &&
                        (d.justified ? (
                          <Button
                            size="sm"
                            variant="outline"
                            loading={busy === d.attendance_day_id}
                            onClick={() => uphold(d)}
                          >
                            Uphold
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setWaiving(d)}>
                            Waive
                          </Button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {waiving && (
        <WaiveModal day={waiving} onClose={() => setWaiving(null)} onSaved={q.reload} />
      )}
    </div>
  );
}

export default AttendanceDaysView;
