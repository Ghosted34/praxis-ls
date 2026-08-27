/**
 * Attendance history & analytics — ONE widget, three homes.
 *
 * ── WHY ONE COMPONENT ──────────────────────────────────────────────────────
 *
 * My HR, the HR Attendance history tab and the employee 360 attendance tab ask
 * the same question at three scopes: what did this window look like, and what
 * did it cost. Three components would be three answers — and the one people
 * would trust is whichever they happened to open first. So the scope is a prop
 * and everything else is shared: the same period chips, the same KPI
 * definitions, the same heatmap, the same table.
 *
 * ── WHAT THE SCOPES CHANGE ─────────────────────────────────────────────────
 *
 *   self   `/mine` endpoints. No grant, no selectors, own map pins only.
 *   hr     the MOD-14 endpoints, plus employee multi-select and a department
 *          filter, plus waive/uphold on rows that carry a deduction.
 *   hr + employeeId
 *          the same HR endpoints pinned to one person (employee 360). The
 *          selectors are hidden because the scope is already decided.
 *
 * ── LEAVE, HOLIDAYS AND DAYS OFF ARE ROWS ──────────────────────────────────
 *
 * The old employee-360 punch table listed clock-ins, so a day of approved leave
 * and a day somebody skipped looked identical: absent from the list. The
 * reconciled day (0697) makes ON_LEAVE / HOLIDAY / WEEKEND / OFF first-class
 * statuses, and this table shows them as rows. "Why is nothing charged here" is
 * a question the screen answers rather than raises.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Callout } from "@/components/ui/callout";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, dateFmt, enumLabel } from "@/lib/format";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";
import { SitePill } from "./attendance-site-pill";
import { MyAttendanceMap } from "./attendance-map";
import { WaiveModal } from "./attendance-days";
import { PERIODS, periodRange, type Period } from "./attendance-period";

export type HistoryScope = "self" | "hr";
/** KpiTile's own tone union, named so a computed tone stays typed rather than
 *  widening to `string` and failing at the prop. */
type KpiTone = React.ComponentProps<typeof KpiTile>["tone"];

const num = (v: unknown) => (v == null ? 0 : Number(v));

const STATUS_TONE: Record<string, Tone> = {
  PRESENT: "ok",
  LATE: "warn",
  ABSENT: "bad",
  ON_LEAVE: "blue",
  HOLIDAY: "mute",
  WEEKEND: "mute",
  OFF: "mute",
};

/** A percentage that may be unknown. `null` is "nothing was measured" — shown
 *  as an em dash, never as 0% (which reads as "never") or 100% ("flawless"). */
function Pct({ value }: { value: number | null }) {
  return <>{value === null ? "—" : `${value}%`}</>;
}

/* ── Period chips + custom range ─────────────────────────────────────────── */

/** Exported so the Map tab offers the SAME five windows as the history table.
 *  A map with its own idea of "this quarter" is a second period vocabulary, and
 *  the first thing anybody does is compare the two tabs against each other. */
export function PeriodChips({
  period,
  window: win,
  onPeriod,
  onWindow,
}: {
  period: Period;
  window: { from: string; to: string };
  onPeriod: (p: Period) => void;
  onWindow: (w: { from: string; to: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="chips">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={cn("chip", period === p.key && "on")}
            aria-pressed={period === p.key}
            onClick={() => onPeriod(p.key)}
          >
            {tr(p.label)}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="micro">{tr("From")}</span>
            <Input
              type="date"
              value={win.from}
              max={win.to}
              onChange={(e) => onWindow({ ...win, from: e.target.value })}
              className="w-auto"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="micro">{tr("To")}</span>
            <Input
              type="date"
              value={win.to}
              min={win.from}
              onChange={(e) => onWindow({ ...win, to: e.target.value })}
              className="w-auto"
            />
          </label>
        </div>
      )}
    </div>
  );
}

/* ── KPI strip ───────────────────────────────────────────────────────────── */

/** The KPI row from the guide (§3.2), on the shared KpiRow/KpiTile — not a
 *  fork. Tones carry the reading: punctuality below 90% and any absence are
 *  the two a manager acts on. */
function AttendanceKpis({ k }: { k: api.AttendanceTotals }) {
  const punctualTone: KpiTone =
    k.punctuality_pct === null ? "accent" : k.punctuality_pct >= 90 ? "ok" : k.punctuality_pct >= 75 ? "warn" : "bad";
  return (
    <KpiRow fit="content">
      <KpiTile
        label={tr("Punctuality")}
        value={<Pct value={k.punctuality_pct} />}
        hint={`${k.present_days}/${k.attended_days} ${tr("on time")}`}
        tone={punctualTone}
      />
      <KpiTile label={tr("Hours worked")} value={k.hours_worked} tone="accent" />
      <KpiTile
        label={tr("Late")}
        value={k.late_days}
        hint={k.minutes_late ? `${k.minutes_late} ${tr("min")}` : undefined}
        tone={k.late_days ? "warn" : "ok"}
      />
      <KpiTile
        label={tr("Absences")}
        value={k.absent_days}
        hint={k.expected_days ? `${tr("of")} ${k.expected_days} ${tr("expected")}` : undefined}
        tone={k.absent_days ? "bad" : "ok"}
      />
      <KpiTile
        label={tr("On site")}
        value={<Pct value={k.on_site_pct} />}
        /* A no-GPS punch is not counted as off-site — saying how many there
           were is the honest way to show the figure's own coverage. */
        hint={k.no_gps_punches ? `${k.no_gps_punches} ${tr("without location")}` : undefined}
        tone={k.no_gps_punches ? "warn" : "accent"}
      />
      <KpiTile
        label={tr("Days off")}
        value={k.days_off}
        hint={`${k.on_leave_days} ${tr("leave")} · ${k.holiday_days} ${tr("holiday")}`}
        tone="info"
      />
      {k.deduction_total > 0 && (
        <KpiTile label={tr("Deducted")} value={money(k.deduction_total)} tone="bad" />
      )}
      {k.waived_total > 0 && (
        <KpiTile label={tr("Waived")} value={money(k.waived_total)} tone="info" />
      )}
    </KpiRow>
  );
}

/* ── Heatmap ─────────────────────────────────────────────────────────────── */

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** The tone of one day. Ordered by what a manager needs to see first: an
 *  absence outranks a lateness outranks a normal day. */
function cellTone(c: api.AttendanceHeatCell): { cls: string; label: string } {
  if (c.absent > 0) return { cls: "bg-[rgb(var(--bad))]", label: tr("Absent") };
  if (c.late > 0) return { cls: "bg-[rgb(var(--warn))]", label: tr("Late") };
  if (c.present > 0) return { cls: "bg-[rgb(var(--ok))]", label: tr("Present") };
  if (c.on_leave > 0) return { cls: "bg-[rgb(var(--brand-blue))]", label: tr("On leave") };
  if (c.holiday > 0) return { cls: "bg-muted", label: tr("Holiday") };
  // Expected, nothing recorded: the reconciler has not run for this date yet.
  if ((c.expected ?? 0) > 0) return { cls: "border border-dashed bg-transparent", label: tr("Not reconciled") };
  // Not a working day for anybody in scope. Faint, not absent — the point of a
  // heatmap over EXPECTED days is that the shape of the week is visible.
  return { cls: "bg-muted/40", label: tr("Not a working day") };
}

/**
 * A calendar of the window: one column per week, one row per weekday.
 *
 * Scrolls inside its own box. A year is 53 columns, and a page that scrolls
 * sideways because of one widget is worse than a widget that scrolls.
 */
function Heatmap({ cells }: { cells: api.AttendanceHeatCell[] }) {
  const weeks = React.useMemo(() => {
    const out: (api.AttendanceHeatCell | null)[][] = [];
    let week: (api.AttendanceHeatCell | null)[] = new Array(7).fill(null);
    cells.forEach((c, i) => {
      const wd = c.weekday ?? 0;
      week[wd] = c;
      const last = i === cells.length - 1;
      if (wd === 6 || last) {
        out.push(week);
        week = new Array(7).fill(null);
      }
    });
    return out;
  }, [cells]);

  if (!cells.length) return null;

  return (
    <div className="lux-card overflow-x-auto p-3">
      <div className="flex gap-2">
        <div className="flex flex-col gap-[3px] pr-1">
          {WEEKDAYS.map((d, i) => (
            <span key={i} className="micro h-3 leading-3 text-muted-foreground">
              {i % 2 === 1 ? d : ""}
            </span>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {weeks.map((w, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {w.map((c, di) => {
                if (!c) return <span key={di} className="h-3 w-3" />;
                const tone = cellTone(c);
                // `enumLabel`, not a hand-rolled underscore split: the split
                // produced "ON LEAVE" in a tooltip whose neighbours read
                // "Present" and "Absent", and it is the same slip the day table
                // carried. One humaniser, used everywhere a status is shown.
                const detail = c.status
                  ? enumLabel(c.status)
                  : `${c.present + c.late} ${tr("in")} · ${c.absent} ${tr("absent")}`;
                return (
                  <span
                    key={di}
                    className={cn("h-3 w-3 rounded-[2px]", tone.cls)}
                    title={`${c.date} — ${tone.label} · ${detail}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Day table ───────────────────────────────────────────────────────────── */

function DayTable({
  days,
  showEmployee,
  canDecide,
  busy,
  onWaive,
  onUphold,
}: {
  days: api.AttendanceDay[];
  showEmployee: boolean;
  canDecide: boolean;
  busy: string | null;
  onWaive: (d: api.AttendanceDay) => void;
  onUphold: (d: api.AttendanceDay) => void;
}) {
  return (
    <div className="lux-card overflow-hidden">
      <div className="max-h-[52vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[rgb(var(--surface))]">
            <tr className="border-b text-left">
              <th className="whitespace-nowrap px-3 py-2 font-semibold uppercase text-muted-foreground">{tr("Date")}</th>
              {showEmployee && (
                <th className="whitespace-nowrap px-3 py-2 font-semibold uppercase text-muted-foreground">{tr("Employee")}</th>
              )}
              <th className="whitespace-nowrap px-3 py-2 font-semibold uppercase text-muted-foreground">{tr("Status")}</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold uppercase text-muted-foreground">{tr("Clock in")}</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold uppercase text-muted-foreground">{tr("Clock out")}</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-semibold uppercase text-muted-foreground">{tr("Late")}</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold uppercase text-muted-foreground">{tr("On site")}</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-semibold uppercase text-muted-foreground">{tr("Deduction")}</th>
              {canDecide && (
                <th className="px-3 py-2">
                  <span className="sr-only">{tr("Actions")}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const charged = num(d.deduction_amount) > 0;
              return (
                <tr key={d.attendance_day_id} className="border-b last:border-0">
                  <td className="num whitespace-nowrap px-3 py-1.5 text-muted-foreground">{dateFmt(d.work_date)}</td>
                  {showEmployee && <td className="px-3 py-1.5 font-medium text-foreground">{d.employee_name || "—"}</td>}
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      {/* Leave, holidays and days off are ROWS, not gaps.
                          The RAW status goes to Pill, which sentence-cases an
                          enum through the shared `enumLabel` — pre-splitting it
                          here would defeat that and print "ON LEAVE" in a
                          column of "Present" and "Absent". */}
                      <Pill tone={STATUS_TONE[d.status] || "mute"}>{d.status}</Pill>
                      {d.leave_type_name && <span className="micro normal-case">{d.leave_type_name}</span>}
                      {d.justified && <Pill tone="mute">{tr("Waived")}</Pill>}
                    </div>
                  </td>
                  <td className="num whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                    {d.first_clock_in_at ? dateFmt(d.first_clock_in_at) : "—"}
                  </td>
                  <td className="num whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                    {d.last_clock_out_at ? dateFmt(d.last_clock_out_at) : "—"}
                  </td>
                  <td className="num whitespace-nowrap px-3 py-1.5 text-right text-muted-foreground">
                    {d.minutes_late > 0 ? `${d.minutes_late} ${tr("min")}` : "—"}
                  </td>
                  <td className="px-3 py-1.5">
                    {d.attendance_id ? (
                      <SitePill within={d.within_geofence ?? null} status={d.location_status} />
                    ) : (
                      <span className="micro">—</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "num whitespace-nowrap px-3 py-1.5 text-right",
                      charged && !d.justified ? "font-semibold text-[rgb(var(--bad))]" : "text-muted-foreground",
                    )}
                  >
                    {charged ? money(d.deduction_amount) : "—"}
                  </td>
                  {canDecide && (
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      {/* Waive/uphold stays exactly where it was: on the history
                          rows that carry a deduction, and nowhere else. */}
                      {charged &&
                        (d.justified ? (
                          <Button size="sm" variant="outline" loading={busy === d.attendance_day_id} onClick={() => onUphold(d)}>
                            {tr("Uphold")}
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => onWaive(d)}>
                            {tr("Waive")}
                          </Button>
                        ))}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Compare table (HR, several people) ──────────────────────────────────── */

function CompareTable({ rows }: { rows: api.AttendanceAnalytics["byEmployee"] }) {
  return (
    <div className="lux-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="px-3 py-2 font-semibold uppercase text-muted-foreground">{tr("Employee")}</th>
            <th className="px-3 py-2 font-semibold uppercase text-muted-foreground">{tr("Department")}</th>
            <th className="px-3 py-2 text-right font-semibold uppercase text-muted-foreground">{tr("Punctuality")}</th>
            <th className="px-3 py-2 text-right font-semibold uppercase text-muted-foreground">{tr("Late")}</th>
            <th className="px-3 py-2 text-right font-semibold uppercase text-muted-foreground">{tr("Absences")}</th>
            <th className="px-3 py-2 text-right font-semibold uppercase text-muted-foreground">{tr("Hours worked")}</th>
            <th className="px-3 py-2 text-right font-semibold uppercase text-muted-foreground">{tr("Deduction")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employee_id} className="border-b last:border-0">
              <td className="px-3 py-1.5 font-medium text-foreground">{r.employee_name || "—"}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{r.department || "—"}</td>
              <td className="num px-3 py-1.5 text-right">
                <Pct value={r.punctuality_pct} />
              </td>
              <td className="num px-3 py-1.5 text-right text-muted-foreground">{r.late_days}</td>
              <td className="num px-3 py-1.5 text-right text-muted-foreground">{r.absent_days}</td>
              <td className="num px-3 py-1.5 text-right text-muted-foreground">{r.hours_worked}</td>
              <td className="num px-3 py-1.5 text-right text-muted-foreground">
                {r.deduction_total > 0 ? money(r.deduction_total) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── The widget ──────────────────────────────────────────────────────────── */

export function AttendanceHistory({
  scope = "hr",
  employeeId = null,
}: {
  /** `self` uses the `/mine` endpoints and shows no selectors. */
  scope?: HistoryScope;
  /** Pins the HR view to one person (employee 360). */
  employeeId?: string | null;
}) {
  const [period, setPeriod] = React.useState<Period>("month");
  const [win, setWin] = React.useState(() => periodRange("month"));
  const [picked, setPicked] = React.useState<string[]>([]);
  const [department, setDepartment] = React.useState("");
  const [downloading, setDownloading] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [waiving, setWaiving] = React.useState<api.AttendanceDay | null>(null);

  const self = scope === "self";
  // The selectors only make sense when the scope is not already decided.
  const showFilters = !self && !employeeId;

  function choosePeriod(p: Period) {
    setPeriod(p);
    // `custom` keeps whatever window is on screen as its starting point, so
    // switching to it is an invitation to adjust rather than a reset.
    if (p !== "custom") setWin(periodRange(p));
  }

  const idsParam = picked.length ? picked.join(",") : undefined;
  const q = useResource(
    () =>
      self
        ? api.myAttendanceAnalytics({ from: win.from, to: win.to })
        : api.attendanceAnalytics({
          from: win.from,
          to: win.to,
          employee_id: employeeId || undefined,
          employee_ids: idsParam,
          department: department || undefined,
        }),
    [self, win.from, win.to, employeeId, idsParam, department],
  );

  const employees = useResource(
    () => (showFilters ? api.listEmployees() : Promise.resolve([] as api.Employee[])),
    [showFilters],
  );
  const departments = React.useMemo(() => {
    const set = new Set<string>();
    for (const e of employees.data || []) if (e.department) set.add(e.department);
    return [...set].sort();
  }, [employees.data]);

  const data = q.data;
  const days = data ? data.days : [];

  async function download(format: api.ExportFormat) {
    setDownloading(format);
    setError(null);
    try {
      if (self) await api.downloadMyAttendanceExport(win, format);
      else {
        await api.downloadAttendanceExport(
          {
            from: win.from,
            to: win.to,
            employee_id: employeeId || undefined,
            employee_ids: idsParam,
            department: department || undefined,
          },
          format,
        );
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setDownloading(null);
    }
  }

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

  function toggleEmployee(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodChips period={period} window={win} onPeriod={choosePeriod} onWindow={setWin} />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" loading={downloading === "csv"} onClick={() => download("csv")}>
            {tr("CSV")}
          </Button>
          <Button size="sm" variant="outline" loading={downloading === "xlsx"} onClick={() => download("xlsx")}>
            {tr("Excel")}
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="micro">{tr("Department")}</span>
            <Select
              className="w-auto"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="">{tr("All departments")}</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="micro">
              {tr("Compare employees")}
              {picked.length ? ` · ${picked.length}` : ""}
            </span>
            {/* A chip per person rather than a multi-select box: the set is the
                point of the screen, so what is in it has to be readable at a
                glance rather than behind a dropdown. */}
            <div className="chips max-h-24 overflow-y-auto">
              {(employees.data || [])
                .filter((e) => e.is_active !== false)
                .filter((e) => !department || e.department === department)
                .map((e) => (
                  <button
                    key={e.employee_id}
                    type="button"
                    className={cn("chip", picked.includes(e.employee_id) && "on")}
                    aria-pressed={picked.includes(e.employee_id)}
                    onClick={() => toggleEmployee(e.employee_id)}
                  >
                    {e.full_name || "—"}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {error && <ErrorState message={error} />}
      {q.error ? (
        <ErrorState message={q.error} />
      ) : !data && q.loading ? (
        <EmptyState title={tr("Loading attendance…")} />
      ) : !data ? null : (
        <>
          {data.truncated && (
            <Callout tone="warn" title={tr("This window was cut short")}>
              {tr("There were more days than one report can carry. Narrow the period, the department or the compare set.")}
            </Callout>
          )}

          <AttendanceKpis k={data.kpis} />
          <Heatmap cells={data.heatmap} />

          {days.length === 0 ? (
            <EmptyState
              title={tr("No reconciled days in this window")}
              hint={tr("Reconciliation runs overnight on completed days, so today is never here yet.")}
            />
          ) : (
            <DayTable
              days={days}
              showEmployee={!self && !employeeId}
              canDecide={!self}
              busy={busy}
              onWaive={setWaiving}
              onUphold={uphold}
            />
          )}

          {/* Own map pins (guide §3.2) — SELF ONLY, and on the window the
              chips above already chose, so the pins and the table are answering
              the same question. It reads `/attendance/punches/mine`, not the
              map endpoint: an HR manager opening their own My HR page must see
              themselves here, not their team. */}
          {self && !employeeId && (
            <div className="flex flex-col gap-2">
              <p className="micro">{tr("Where you clocked in")}</p>
              <MyAttendanceMap from={win.from} to={win.to} />
            </div>
          )}

          {/* The compare table only earns its space when there is something to
              compare — one person's row beside their own KPIs is noise. */}
          {!self && !employeeId && data.byEmployee.length > 1 && (
            <div className="flex flex-col gap-2">
              <p className="micro">{tr("Compare")}</p>
              <CompareTable rows={data.byEmployee} />
            </div>
          )}
        </>
      )}

      {/* Waiving moves money off a payslip, so it keeps its reason and its own
          dialog — the SAME one the reconciled-days view raises, not a copy. */}
      {waiving && (
        <WaiveModal day={waiving} onClose={() => setWaiving(null)} onSaved={q.reload} />
      )}
    </div>
  );
}

export default AttendanceHistory;
