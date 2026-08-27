/**
 * The shared attendance history widget (PR2).
 *
 * WHAT THESE PIN
 *
 *   - The period chips actually move the WINDOW that gets requested. A chip row
 *     that changes its own highlight and nothing else is the failure mode here,
 *     and it looks completely correct on screen.
 *   - The self scope talks to `/mine` and the HR scope does not. This is the
 *     access boundary, and it is one prop away from being wrong in a way no
 *     type would catch.
 *   - Leave, holidays and days off are ROWS. The table this replaces listed
 *     punches, so approved leave and skipping work looked identical: absent.
 *   - A rate over nothing renders "—", not 0%.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const attendanceAnalytics = vi.fn();
const myAttendanceAnalytics = vi.fn();
const listEmployees = vi.fn();
const downloadAttendanceExport = vi.fn();
const downloadMyAttendanceExport = vi.fn();

vi.mock("@/lib/hr-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hr-api")>("@/lib/hr-api");
  return {
    ...actual,
    attendanceAnalytics: (...a: unknown[]) => attendanceAnalytics(...a),
    myAttendanceAnalytics: (...a: unknown[]) => myAttendanceAnalytics(...a),
    listEmployees: (...a: unknown[]) => listEmployees(...a),
    downloadAttendanceExport: (...a: unknown[]) => downloadAttendanceExport(...a),
    downloadMyAttendanceExport: (...a: unknown[]) => downloadMyAttendanceExport(...a),
  };
});

import { AttendanceHistory } from "./attendance-history";
import { periodRange } from "./attendance-period";
import type { AttendanceAnalytics, AttendanceDay, AttendanceTotals } from "@/lib/hr-api";

const totals = (over: Partial<AttendanceTotals> = {}): AttendanceTotals => ({
  employees: 1,
  expected_days: 20,
  reconciled_days: 20,
  attended_days: 18,
  present_days: 16,
  late_days: 2,
  absent_days: 1,
  on_leave_days: 1,
  holiday_days: 0,
  off_days: 8,
  days_off: 9,
  minutes_late: 45,
  hours_worked: 144.5,
  deduction_total: 5000,
  waived_total: 0,
  punches: 18,
  on_site_punches: 15,
  off_site_punches: 2,
  no_gps_punches: 1,
  unfenced_punches: 0,
  punctuality_pct: 88.9,
  attendance_pct: 90,
  absence_pct: 5,
  on_site_pct: 88.2,
  ...over,
});

const day = (over: Partial<AttendanceDay> = {}): AttendanceDay => ({
  attendance_day_id: `d-${Math.random().toString(36).slice(2)}`,
  employee_id: "e1",
  employee_name: "Ada Mbarga",
  work_date: "2026-08-03",
  status: "PRESENT",
  minutes_late: 0,
  daily_rate: 22000,
  deduction_pct: 0,
  deduction_amount: 0,
  justified: false,
  ...over,
});

const payload = (over: Partial<AttendanceAnalytics> = {}): AttendanceAnalytics => ({
  window: { from: "2026-08-01", to: "2026-08-20", days: 20 },
  kpis: totals(),
  heatmap: [
    { date: "2026-08-01", weekday: 6, expected: 0, reconciled: 1, present: 0, late: 0, absent: 0, on_leave: 0, holiday: 0, off: 1, minutes_late: 0, hours_worked: 0, status: "WEEKEND" },
    { date: "2026-08-03", weekday: 1, expected: 1, reconciled: 1, present: 1, late: 0, absent: 0, on_leave: 0, holiday: 0, off: 0, minutes_late: 0, hours_worked: 8, status: "PRESENT" },
  ],
  byDepartment: [],
  byEmployee: [],
  days: [day()],
  truncated: false,
  timezone: "Africa/Douala",
  expected_source: "calendar",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  attendanceAnalytics.mockResolvedValue(payload());
  myAttendanceAnalytics.mockResolvedValue(payload());
  listEmployees.mockResolvedValue([
    { employee_id: "e1", full_name: "Ada Mbarga", department: "Operations", is_active: true },
    { employee_id: "e2", full_name: "Bola Njie", department: "Finance", is_active: true },
  ]);
  downloadAttendanceExport.mockResolvedValue(undefined);
  downloadMyAttendanceExport.mockResolvedValue(undefined);
});

/* ── The period helper ─────────────────────────────────────────────────── */

describe("periodRange", () => {
  // A Wednesday, mid-month, mid-quarter — so every period has a distinct answer.
  const today = new Date("2026-08-19T10:00:00Z");

  it("7d is the last seven days INCLUDING today — seven cells, not eight", () => {
    expect(periodRange("7d", today)).toEqual({ from: "2026-08-13", to: "2026-08-19" });
  });

  it("month is the month TO DATE, not the whole month", () => {
    // A whole-month window would be mostly future, which reads as a company
    // that stopped turning up.
    expect(periodRange("month", today)).toEqual({ from: "2026-08-01", to: "2026-08-19" });
  });

  it("quarter starts at the quarter's first month", () => {
    expect(periodRange("quarter", today)).toEqual({ from: "2026-07-01", to: "2026-08-19" });
    expect(periodRange("quarter", new Date("2026-02-10T00:00:00Z")).from).toBe("2026-01-01");
    expect(periodRange("quarter", new Date("2026-11-30T00:00:00Z")).from).toBe("2026-10-01");
  });

  it("year starts on 1 January", () => {
    expect(periodRange("year", today)).toEqual({ from: "2026-01-01", to: "2026-08-19" });
  });

  it("year stays inside the 366-day cap the API enforces", () => {
    const { from, to } = periodRange("year", new Date("2028-12-31T00:00:00Z"));
    expect((Date.parse(to) - Date.parse(from)) / 86400000).toBeLessThanOrEqual(366);
  });

  it("custom seeds from the 7-day window rather than opening empty", () => {
    expect(periodRange("custom", today)).toEqual(periodRange("7d", today));
  });
});

/* ── Scope ─────────────────────────────────────────────────────────────── */

describe("scope", () => {
  it("self reads the /mine endpoint and never the HR one", async () => {
    renderScreen(<AttendanceHistory scope="self" />);
    await waitFor(() => expect(myAttendanceAnalytics).toHaveBeenCalled());
    expect(attendanceAnalytics).not.toHaveBeenCalled();
    // Nothing on the self request can name another employee.
    expect(Object.keys(myAttendanceAnalytics.mock.calls[0][0]).sort()).toEqual(["from", "to"]);
  });

  it("self offers no employee or department selectors at all", async () => {
    renderScreen(<AttendanceHistory scope="self" />);
    await waitFor(() => expect(myAttendanceAnalytics).toHaveBeenCalled());
    expect(screen.queryByText("Compare employees")).not.toBeInTheDocument();
    expect(screen.queryByText("All departments")).not.toBeInTheDocument();
    expect(listEmployees).not.toHaveBeenCalled();
  });

  it("hr reads the HR endpoint and offers the selectors", async () => {
    renderScreen(<AttendanceHistory scope="hr" />);
    await waitFor(() => expect(attendanceAnalytics).toHaveBeenCalled());
    expect(myAttendanceAnalytics).not.toHaveBeenCalled();
    expect(await screen.findByText("All departments")).toBeInTheDocument();
  });

  it("hr pinned to one employee sends the id and hides the selectors", async () => {
    renderScreen(<AttendanceHistory scope="hr" employeeId="e1" />);
    await waitFor(() => expect(attendanceAnalytics).toHaveBeenCalled());
    expect(attendanceAnalytics.mock.calls[0][0]).toMatchObject({ employee_id: "e1" });
    expect(screen.queryByText("Compare employees")).not.toBeInTheDocument();
  });
});

/* ── Period chips ──────────────────────────────────────────────────────── */

describe("period chips", () => {
  it("change the window that is actually REQUESTED, not just the highlight", async () => {
    const user = userEvent.setup();
    renderScreen(<AttendanceHistory scope="self" />);
    await waitFor(() => expect(myAttendanceAnalytics).toHaveBeenCalled());
    const first = myAttendanceAnalytics.mock.calls[0][0];
    // Opens on the month to date.
    expect(first.from.slice(-2)).toBe("01");

    await user.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() => expect(myAttendanceAnalytics.mock.calls.length).toBeGreaterThan(1));
    const next = myAttendanceAnalytics.mock.calls.at(-1)![0];
    expect((Date.parse(next.to) - Date.parse(next.from)) / 86400000).toBe(6);
  });

  it("marks the active chip for assistive technology, not only with a colour", async () => {
    const user = userEvent.setup();
    renderScreen(<AttendanceHistory scope="self" />);
    await waitFor(() => expect(myAttendanceAnalytics).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "This year" }));
    expect(screen.getByRole("button", { name: "This year" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reveals the custom range inputs only when custom is chosen", async () => {
    const user = userEvent.setup();
    renderScreen(<AttendanceHistory scope="self" />);
    await waitFor(() => expect(myAttendanceAnalytics).toHaveBeenCalled());
    expect(screen.queryByText("From")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByText("From")).toBeInTheDocument();
    expect(screen.getByText("To")).toBeInTheDocument();
  });
});

/* ── Download ──────────────────────────────────────────────────────────── */

describe("download", () => {
  it("self hits the /mine export, with the window on screen", async () => {
    const user = userEvent.setup();
    renderScreen(<AttendanceHistory scope="self" />);
    await waitFor(() => expect(myAttendanceAnalytics).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Excel" }));
    await waitFor(() => expect(downloadMyAttendanceExport).toHaveBeenCalled());
    expect(downloadAttendanceExport).not.toHaveBeenCalled();
    const [win, format] = downloadMyAttendanceExport.mock.calls[0];
    expect(format).toBe("xlsx");
    expect(win).toEqual(myAttendanceAnalytics.mock.calls.at(-1)![0]);
  });

  it("self CSV asks for csv", async () => {
    const user = userEvent.setup();
    renderScreen(<AttendanceHistory scope="self" />);
    await waitFor(() => expect(myAttendanceAnalytics).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "CSV" }));
    await waitFor(() => expect(downloadMyAttendanceExport).toHaveBeenCalled());
    expect(downloadMyAttendanceExport.mock.calls[0][1]).toBe("csv");
  });

  it("hr hits the HR export, carrying the filters", async () => {
    const user = userEvent.setup();
    renderScreen(<AttendanceHistory scope="hr" employeeId="e1" />);
    await waitFor(() => expect(attendanceAnalytics).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Excel" }));
    await waitFor(() => expect(downloadAttendanceExport).toHaveBeenCalled());
    expect(downloadMyAttendanceExport).not.toHaveBeenCalled();
    expect(downloadAttendanceExport.mock.calls[0][0]).toMatchObject({ employee_id: "e1" });
  });
});

/* ── KPIs and rows ─────────────────────────────────────────────────────── */

describe("the report", () => {
  it("shows the KPI row from the payload", async () => {
    renderScreen(<AttendanceHistory scope="self" />);
    expect(await screen.findByText("88.9%")).toBeInTheDocument(); // punctuality
    expect(screen.getByText("144.5")).toBeInTheDocument(); // hours
    expect(screen.getByText("Absences")).toBeInTheDocument();
    expect(screen.getByText("88.2%")).toBeInTheDocument(); // on-site
  });

  it("renders an unmeasurable rate as an em dash, not as 0%", async () => {
    myAttendanceAnalytics.mockResolvedValue(
      payload({ kpis: totals({ punctuality_pct: null, on_site_pct: null, attended_days: 0 }) }),
    );
    renderScreen(<AttendanceHistory scope="self" />);
    // findByText, not waitFor-on-the-mock: the mock is called before the render
    // settles, so asserting on the call would race the paint.
    const strip = (await screen.findByText("Punctuality")).closest("div")!;
    expect(within(strip).getByText("—")).toBeInTheDocument();
  });

  it("says so when the row cap cut the window short", async () => {
    myAttendanceAnalytics.mockResolvedValue(payload({ truncated: true }));
    renderScreen(<AttendanceHistory scope="self" />);
    expect(await screen.findByText("This window was cut short")).toBeInTheDocument();
  });

  it("shows leave, holidays and days off as ROWS — not as missing punches", async () => {
    myAttendanceAnalytics.mockResolvedValue(
      payload({
        days: [
          day({ work_date: "2026-08-03", status: "ON_LEAVE", leave_type_name: "Annual leave" }),
          day({ work_date: "2026-08-04", status: "HOLIDAY" }),
          day({ work_date: "2026-08-05", status: "WEEKEND" }),
          day({ work_date: "2026-08-06", status: "ABSENT", deduction_amount: 22000 }),
        ],
      }),
    );
    renderScreen(<AttendanceHistory scope="self" />);
    // Sentence-cased by the shared `enumLabel` inside Pill — the same way every
    // other enum in the product renders.
    expect(await screen.findByText("On leave")).toBeInTheDocument();
    expect(screen.getByText("Annual leave")).toBeInTheDocument();
    expect(screen.getByText("Holiday")).toBeInTheDocument();
    expect(screen.getByText("Weekend")).toBeInTheDocument();
    expect(screen.getByText("Absent")).toBeInTheDocument();
  });

  it("offers no waive control on the employee's own view", async () => {
    myAttendanceAnalytics.mockResolvedValue(
      payload({ days: [day({ status: "LATE", minutes_late: 20, deduction_amount: 5000 })] }),
    );
    renderScreen(<AttendanceHistory scope="self" />);
    // Scoped to the table: "Late" is also a KPI label, and an unscoped query
    // would pass on the strip while the row it is really about never rendered.
    // Scoped to the DATA row: "Late" is also a KPI label and this table's own
    // column header, so an unscoped query would pass on either while the row it
    // is really about never rendered.
    const table = await screen.findByRole("table");
    const [, row] = within(table).getAllByRole("row");
    expect(within(row).getByText("Late")).toBeInTheDocument();
    // Waiving is `approve`. An employee looking at their own record must not be
    // offered the button that forgives it.
    expect(screen.queryByRole("button", { name: "Waive" })).not.toBeInTheDocument();
  });

  it("offers waive on an HR row that carries a deduction", async () => {
    attendanceAnalytics.mockResolvedValue(
      payload({ days: [day({ status: "LATE", minutes_late: 20, deduction_amount: 5000 })] }),
    );
    renderScreen(<AttendanceHistory scope="hr" employeeId="e1" />);
    expect(await screen.findByRole("button", { name: "Waive" })).toBeInTheDocument();
  });

  it("offers nothing to waive on an HR row that carries no deduction", async () => {
    attendanceAnalytics.mockResolvedValue(payload({ days: [day({ status: "PRESENT" })] }));
    renderScreen(<AttendanceHistory scope="hr" employeeId="e1" />);
    const table = await screen.findByRole("table");
    const [, row] = within(table).getAllByRole("row");
    expect(within(row).getByText("Present")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Waive" })).not.toBeInTheDocument();
  });

  it("is honest when the window has no reconciled days", async () => {
    myAttendanceAnalytics.mockResolvedValue(payload({ days: [] }));
    renderScreen(<AttendanceHistory scope="self" />);
    expect(await screen.findByText("No reconciled days in this window")).toBeInTheDocument();
  });

  it("surfaces a failure rather than rendering an empty report", async () => {
    myAttendanceAnalytics.mockRejectedValue(new Error("nope"));
    renderScreen(<AttendanceHistory scope="self" />);
    await waitFor(() => expect(myAttendanceAnalytics).toHaveBeenCalled());
    expect(screen.queryByText("No reconciled days in this window")).not.toBeInTheDocument();
  });
});
