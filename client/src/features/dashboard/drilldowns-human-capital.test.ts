/**
 * Human Capital drill builders (PR-4, guide §5.5/D12).
 *
 * The rules these pin are the band's, restated for the six HR tiles:
 *
 *   - RECONCILIATION: the drill's headline counts derive from the same
 *     predicates the tile counted (pending leave, open vacancies, in-flight
 *     payroll runs), so a figure on the card and the table under it cannot
 *     disagree by construction.
 *   - THE SALARY RULE (§9): a figure the reader may not see arrives null and
 *     renders as "—" — never as 0, which would answer a question the mask
 *     says they may not ask.
 *   - THE HONEST NOTE: wherever the table is a page-scoped scan rather than
 *     the aggregate (headcount over 200, attrition's event-vs-register
 *     basis), the drill says so.
 */
import { describe, expect, it } from "vitest";
import {
  KPI_ROUTE,
  buildAttendanceDrill,
  buildAttritionDrill,
  buildHeadcountDrill,
  buildLeaveDrill,
  buildPayrollDrill,
  buildVacanciesDrill,
} from "./drilldowns";
import { formatBandValue, type BandSlot } from "./kpi-model";

const t = (k: string) =>
  ({
    "dash.unitVehicles": "vehicles",
    "dash.unitDays": "days",
    "dash.unitExpected": "expected",
  })[k] ?? k;

describe("KPI_ROUTE — the HR tiles route to their module hubs", () => {
  it("declares all six Human Capital destinations", () => {
    expect(KPI_ROUTE.headcount).toBe("/hr/employees");
    expect(KPI_ROUTE.attendance_today).toBe("/hr/attendance");
    expect(KPI_ROUTE.leave_pending).toBe("/hr/leave");
    expect(KPI_ROUTE.vacancies_open).toBe("/hr/vacancies");
    expect(KPI_ROUTE.payroll_run_state).toBe("/hr/payroll");
    expect(KPI_ROUTE.attrition_90d).toBe("/hr/employees");
  });
});

describe("buildHeadcountDrill", () => {
  const employees = [
    { employee_id: "e1", full_name: "Amadou Diallo", department: "Operations", job_title: "Driver" },
    { employee_id: "e2", full_name: "Clarisse Fotso", department: "Finance", job_title: "Accountant" },
  ];

  it("counts the page and its departments — the register list sends no total", () => {
    const d = buildHeadcountDrill(employees);
    expect(d.badge.text).toBe("2 active");
    expect(d.meta.find((m) => m.label === "Active (page)")?.value).toBe("2");
    expect(d.meta.find((m) => m.label === "Departments")?.value).toBe("2");
    expect(d.rows[0].cells[0]).toBe("Amadou Diallo");
  });

  it("states the basis when the page sits at its cap — never invents a total", () => {
    const page = Array.from({ length: 200 }, (_, i) => ({
      employee_id: `e${i}`,
      full_name: `Employee ${i}`,
      department: "Operations",
      job_title: "Driver",
    }));
    const d = buildHeadcountDrill(page);
    expect(d.note).toMatch(/200 most recent/);
    expect(d.note).toMatch(/whole register/);
  });

  it("offers an empty state, not an empty table, on an empty register", () => {
    const d = buildHeadcountDrill([]);
    expect(d.rows).toHaveLength(0);
    expect(d.empty.title).toBe("No active employees");
  });

  it("survives a null page — the register may be off for this tenant", () => {
    const d = buildHeadcountDrill(null);
    expect(d.rows).toHaveLength(0);
  });
});

describe("buildAttendanceDrill", () => {
  const punches = [
    { attendance_id: "a1", employee_id: "e1", employee_name: "Amadou Diallo", department: "Operations", clock_in_at: "2026-09-15T07:02:00Z", clock_out_at: null },
    { attendance_id: "a2", employee_id: "e1", employee_name: "Amadou Diallo", department: "Operations", clock_in_at: "2026-09-15T12:00:00Z", clock_out_at: "2026-09-15T12:40:00Z" },
    { attendance_id: "a3", employee_id: "e2", employee_name: "Clarisse Fotso", department: "Finance", clock_in_at: "2026-09-15T07:58:00Z", clock_out_at: null },
  ];

  it("counts PEOPLE, not punch rows — a re-badge is one present", () => {
    const d = buildAttendanceDrill(punches);
    expect(d.meta.find((m) => m.label === "Clocked in")?.value).toBe("2");
    expect(d.meta.find((m) => m.label === "Punches")?.value).toBe("3");
  });

  it("survives a null page — attendance may be off for this tenant", () => {
    const d = buildAttendanceDrill(null);
    expect(d.rows).toHaveLength(0);
    expect(d.empty.title).toBe("Nobody has clocked in yet");
  });
});

describe("buildLeaveDrill", () => {
  const requests = [
    { leave_request_id: "l1", employee_id: "e1", employee_name: "Amadou Diallo", status: "REQUESTED", leave_type_name: "Annual", starts_on: "2026-09-20", ends_on: "2026-09-27" },
    { leave_request_id: "l2", employee_id: "e2", employee_name: "Clarisse Fotso", status: "APPROVED", leave_type_name: "Annual", starts_on: "2026-09-01", ends_on: "2026-09-02" },
  ];

  it("shows only what still awaits a decision, whatever the page carried in", () => {
    const d = buildLeaveDrill(requests);
    expect(d.meta.find((m) => m.label === "Pending")?.value).toBe("1");
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].cells[0]).toBe("Amadou Diallo");
  });

  it("names the earliest start, the fact the approver plans around", () => {
    const d = buildLeaveDrill(requests);
    expect(d.meta.find((m) => m.label === "Earliest starts")?.value).toBeTruthy();
  });
});

describe("buildVacanciesDrill", () => {
  const vacancies = [
    { vacancy_id: "v1", title: "Customs broker", department: "Customs", status: "OPEN", posted_to_website: true, created_at: "2026-08-30" },
    { vacancy_id: "v2", title: "Storekeeper", department: "Warehouse", status: "CLOSED", posted_to_website: false, created_at: "2026-07-01" },
  ];

  it("counts only OPEN vacancies — a closed role is not one being hired for", () => {
    const d = buildVacanciesDrill(vacancies);
    expect(d.meta.find((m) => m.label === "Open")?.value).toBe("1");
    expect(d.meta.find((m) => m.label === "On the website")?.value).toBe("1");
    expect(d.rows[0].cells[0]).toBe("Customs broker");
  });
});

describe("buildPayrollDrill", () => {
  const runs = [
    { payroll_run_id: "p1", period_code: "2026-09", status: "COMPUTED", updated_at: "2026-09-12" },
    { payroll_run_id: "p2", period_code: "2026-08", status: "DISBURSED", updated_at: "2026-09-02" },
    { payroll_run_id: "p3", period_code: "2026-05", status: "SUBMITTED", updated_at: "2026-06-01" },
  ];

  it("puts the in-flight runs first — that is what the tile was opened for", () => {
    const d = buildPayrollDrill(runs, null, "XAF");
    expect(d.badge.text).toBe("2 in flight");
    expect(d.rows[0].cells[0]).toBe("2026-09");
    expect(d.rows[1].cells[0]).toBe("2026-05");
    expect(d.rows[2].cells[0]).toBe("2026-08"); // settled last
  });

  it("renders the payslip figures when the reader may see them", () => {
    const detail = { items: [{ employee_name: "A", net_pay: 250000 }, { employee_name: "B", net_pay: 300000 }] };
    const d = buildPayrollDrill(runs, detail, "XAF");
    expect(d.meta.find((m) => m.label === "Payslips (in flight)")?.value).toBe("2");
    // `grouped` formats with a locale narrow space — assert the significant
    // digits, not the separator (same discipline as the revenue drill tests).
    expect(d.meta.find((m) => m.label === "Net (in flight), XAF")?.value).toContain("550");
    expect(d.meta.find((m) => m.label === "Net (in flight), XAF")?.value).toContain("XAF");
  });

  it("BLANKS salary figures that arrive null (employee.salary masked) — never zeroes them", () => {
    // The masked reader's API answers null for the governed figures. A "0"
    // here would assert an empty payroll over data they may not read.
    const detail = { items: [{ employee_name: "A", net_pay: null, gross: null }] };
    const d = buildPayrollDrill(runs, detail, "XAF");
    const net = d.meta.find((m) => m.label === "Net (in flight), XAF")?.value;
    expect(net).toBe("—");
    expect(net).not.toContain("XAF"); // no figure was invented from the mask
  });

  it("degrades to em-dash figures when the run detail is unreadable or uncomputed", () => {
    const d = buildPayrollDrill(runs, null, "XAF");
    expect(d.meta.find((m) => m.label === "Payslips (in flight)")?.value).toBe("—");
    expect(d.meta.find((m) => m.label === "Net (in flight), XAF")?.value).toBe("—");
  });

  it("says all settled when nothing is in flight — 0 is the truth then", () => {
    const d = buildPayrollDrill(
      [runs[1]],
      null,
      "XAF",
    );
    expect(d.badge.text).toBe("All runs settled");
    expect(d.meta.find((m) => m.label === "In flight")?.value).toBe("0");
  });
});

describe("buildAttritionDrill", () => {
  it("counts terminations inside the 90-day window and says what the headline is", () => {
    const within = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const outside = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
    const d = buildAttritionDrill([
      { employee_id: "e1", full_name: "Amadou Diallo", status: "TERMINATED", terminated_on: within },
      { employee_id: "e2", full_name: "Clarisse Fotso", status: "TERMINATED", terminated_on: outside },
      { employee_id: "e3", full_name: "Paul Mbarga", status: "SUSPENDED", terminated_on: null },
    ]);
    expect(d.meta.find((m) => m.label === "Left within 90 days")?.value).toBe("1");
    expect(d.meta.find((m) => m.label === "Off the active register")?.value).toBe("3");
    // The tile counts EVENTS; the table is the register — the note says so.
    expect(d.note).toMatch(/employee\.deactivated events/);
    expect(d.note).toMatch(/register/);
  });

  it("an empty register is an honest empty state", () => {
    const d = buildAttritionDrill([]);
    expect(d.rows).toHaveLength(0);
    expect(d.empty.title).toBe("Nobody has left");
  });
});

describe("formatBandValue — the attendance pair noun", () => {
  const slot = (over: Partial<BandSlot>): BandSlot => ({
    id: "attendance_today",
    domain: "human_capital",
    unit: "pair",
    module: "MOD-14",
    status: "live",
    tone: "ok",
    icon: "clock",
    labelKey: "dash.attendanceToday",
    hintKey: "dash.attendanceTodayHint",
    badgeKey: null,
    drillTo: "/hr/attendance",
    value: 0,
    denominator: null,
    measurable: true,
    ...over,
  });

  it("renders n / m expected — the denominator is named, not a bare fraction", () => {
    expect(formatBandValue(slot({ value: 18, denominator: 25 }), "XAF", t)).toEqual({
      text: "18",
      unit: "/ 25 expected",
    });
  });

  it("renders 0 / 0 expected — 'nobody was expected', distinguishable from 'all absent'", () => {
    const out = formatBandValue(slot({ value: 0, denominator: 0, measurable: false }), "XAF", t);
    expect(out).toEqual({ text: "0", unit: "/ 0 expected" });
  });
});
