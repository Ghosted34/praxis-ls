"use strict";
/**
 * The export (PR2).
 *
 * ── THE COLUMN LIST IS THE TEST ────────────────────────────────────────────
 *
 * Payroll parses these files by key. The literal arrays below are copied from
 * the engineering guide §3.5 and are DELIBERATELY spelled out rather than read
 * back from the module — a test that asserts `daysColumns()` matches
 * `DAYS_KEYS` proves the module agrees with itself, which is exactly the
 * property that survives somebody renaming a column in both places at once.
 *
 * If one of these assertions fails, the question is not "which spelling did we
 * settle on" — it is "whose month-end did that just break".
 */

const { parseCsv, parseWorkbook } = require("../../src/services/spreadsheet");
const {
  toExport,
  daysRows,
  punchRows,
  daysColumns,
  punchColumns,
  exportName,
  MAX_ROWS,
} = require("../../src/modules/hr/attendance/attendance.export");

/** Guide §3.5, verbatim. Do not edit to match the code. */
const GUIDE_DAYS = [
  "employee", "department", "entity", "work_date", "weekday", "expected", "status",
  "expected_start", "first_in", "last_out", "hours", "minutes_late", "on_site",
  "geo_label", "device_label", "device_trusted", "deduction", "waived",
  "justification", "leave_type", "rule_code",
];
const GUIDE_PUNCHES = [
  "employee", "clock_in", "clock_out", "lat", "lng", "within_geofence",
  "geo_label", "distance_m", "device", "late",
];

const ADA = "11111111-1111-1111-1111-111111111111";
const MON = "2026-08-03";

const dayRow = {
  employee_id: ADA,
  employee_name: "Ada Mbarga",
  department: "Operations",
  entity_name: "Praxis Douala SARL",
  work_date: MON,
  status: "LATE",
  expected_start_time: "07:30:00",
  first_clock_in_at: "2026-08-03T07:55:00Z",
  last_clock_out_at: "2026-08-03T16:00:00Z",
  minutes_late: 25,
  deduction_amount: "5000.00",
  justified: false,
  justification: null,
  leave_type_name: null,
  rule_code: "LATE-01",
  attendance_id: "punch-1",
  location_source: "gps",
  latitude: 4.05,
  longitude: 9.7,
  within_geofence: true,
  geo_label: "Bonabéri yard",
  device_label: "Ada's phone",
  device_trusted: true,
};

const punchRow = {
  employee_id: ADA,
  employee_name: "Ada Mbarga",
  clock_in_at: "2026-08-03T07:55:00Z",
  clock_out_at: "2026-08-03T16:00:00Z",
  latitude: "4.050000",
  longitude: "9.700000",
  within_geofence: true,
  geo_label: "Bonabéri yard",
  distance_m: "42.50",
  device_label: "Ada's phone",
  is_late: true,
};

describe("the frozen column contract (guide §3.5)", () => {
  it("Days carries exactly the guide's keys, in the guide's order", () => {
    expect(daysColumns().map((c) => c.key)).toEqual(GUIDE_DAYS);
  });

  it("Punches carries exactly the guide's keys, in the guide's order", () => {
    expect(punchColumns().map((c) => c.key)).toEqual(GUIDE_PUNCHES);
  });

  it("emits every key on every row, so a missing value is empty and not absent", () => {
    const [row] = daysRows([{ employee_id: ADA, work_date: MON, status: "ABSENT" }]);
    expect(Object.keys(row).sort()).toEqual([...GUIDE_DAYS].sort());
  });

  it("emits every punch key on every row", () => {
    const [row] = punchRows([{ employee_id: ADA, clock_in_at: "2026-08-03T07:00:00Z" }]);
    expect(Object.keys(row).sort()).toEqual([...GUIDE_PUNCHES].sort());
  });
});

describe("day rows", () => {
  it("projects a reconciled day onto the payroll shape", () => {
    const [row] = daysRows([dayRow], { expectedFor: () => ({ isWorkingDay: true, isHoliday: false }) });
    expect(row).toMatchObject({
      employee: "Ada Mbarga",
      department: "Operations",
      entity: "Praxis Douala SARL",
      work_date: MON,
      weekday: "Mon",
      expected: true,
      status: "LATE",
      expected_start: "07:30",
      minutes_late: 25,
      deduction: 5000,
      waived: false,
      rule_code: "LATE-01",
      device_label: "Ada's phone",
      device_trusted: true,
      geo_label: "Bonabéri yard",
    });
    // 07:55 → 16:00 is 8h05.
    expect(row.hours).toBeCloseTo(8.083, 2);
  });

  it("reports the location as the four-state word, not a yes/no", () => {
    const on = daysRows([dayRow])[0];
    expect(on.on_site).toBe("on_site");
    const noFix = daysRows([{ ...dayRow, location_source: "none", latitude: null, longitude: null, within_geofence: null }])[0];
    // The distinction 10740 exists to make: "we did not get a fix" is not
    // "they were somewhere else".
    expect(noFix.on_site).toBe("no_gps");
    const away = daysRows([{ ...dayRow, within_geofence: false }])[0];
    expect(away.on_site).toBe("off_site");
  });

  it("leaves the location empty on a day with no punch at all", () => {
    const [row] = daysRows([{ employee_id: ADA, work_date: MON, status: "ABSENT" }]);
    // Not "no_gps": an absence never presented a device to have failed.
    expect(row.on_site).toBeNull();
  });

  it("marks `expected` null rather than guessing when no resolver is given", () => {
    expect(daysRows([dayRow])[0].expected).toBeNull();
  });

  it("respects the calendar when it says the day was not owed as work", () => {
    const [row] = daysRows([{ ...dayRow, work_date: "2026-08-01", status: "PRESENT" }], {
      expectedFor: () => ({ isWorkingDay: false, isHoliday: false }),
    });
    expect(row.weekday).toBe("Sat");
    expect(row.expected).toBe(false);
  });

  it("keeps a waived day's figure and flags it, rather than zeroing it", () => {
    const [row] = daysRows([{ ...dayRow, justified: true, justification: "Bridge traffic" }]);
    expect(row).toMatchObject({ deduction: 5000, waived: true, justification: "Bridge traffic" });
  });

  it("names the leave type on a leave day", () => {
    const [row] = daysRows([{ ...dayRow, status: "ON_LEAVE", leave_type_name: "Annual leave" }]);
    expect(row).toMatchObject({ status: "ON_LEAVE", leave_type: "Annual leave" });
  });

  it("caps the rows — an export is a report, not an unbounded page", () => {
    const many = Array.from({ length: MAX_ROWS + 50 }, () => dayRow);
    expect(daysRows(many)).toHaveLength(MAX_ROWS);
    expect(punchRows(many.map(() => punchRow))).toHaveLength(MAX_ROWS);
  });
});

describe("punch rows", () => {
  it("projects a punch onto the payroll shape", () => {
    const [row] = punchRows([punchRow]);
    expect(row).toMatchObject({
      employee: "Ada Mbarga",
      lat: 4.05,
      lng: 9.7,
      within_geofence: true,
      geo_label: "Bonabéri yard",
      distance_m: 42.5,
      device: "Ada's phone",
      late: true,
    });
  });

  it("distinguishes an unjudged geofence from a failed one", () => {
    expect(punchRows([{ ...punchRow, within_geofence: null }])[0].within_geofence).toBeNull();
    expect(punchRows([{ ...punchRow, within_geofence: false }])[0].within_geofence).toBe(false);
  });
});

describe("the file", () => {
  it("is named attendance-{from}-{to}", () => {
    expect(exportName({ from: "2026-08-01", to: "2026-08-31", extension: "xlsx" }))
      .toBe("attendance-2026-08-01-2026-08-31.xlsx");
  });

  it("is unmistakable in sandbox — a Test file must not look like a live one", () => {
    expect(exportName({ from: "2026-08-01", to: "2026-08-31", extension: "csv", env: "sandbox" }))
      .toBe("attendance-2026-08-01-2026-08-31-SANDBOX.csv");
  });

  it("builds a CSV of Days by default, with the guide's headers", async () => {
    const file = await toExport({ days: [dayRow], punches: [punchRow], from: "2026-08-01", to: "2026-08-31", format: "csv" });
    expect(file.contentType).toMatch(/^text\/csv/);
    expect(file.filename).toBe("attendance-2026-08-01-2026-08-31.csv");
    const parsed = parseCsv(file.buffer);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].Employee).toBe("Ada Mbarga");
    expect(parsed[0].Status).toBe("LATE");
    expect(parsed[0]["Minutes late"]).toBe("25");
  });

  it("honours ?sheet=punches for CSV, which cannot carry two sheets", async () => {
    const file = await toExport({ days: [dayRow], punches: [punchRow], from: "2026-08-01", to: "2026-08-31", format: "csv", sheet: "punches" });
    const parsed = parseCsv(file.buffer);
    expect(parsed[0]["Distance (m)"]).toBe("42.5");
    expect(parsed[0].Status).toBeUndefined();
  });

  it("builds an XLSX carrying BOTH sheets — one export, one file", async () => {
    const file = await toExport({ days: [dayRow], punches: [punchRow], from: "2026-08-01", to: "2026-08-31", format: "xlsx" });
    expect(file.contentType).toMatch(/spreadsheetml/);
    expect(file.filename).toBe("attendance-2026-08-01-2026-08-31.xlsx");
    expect(Buffer.isBuffer(file.buffer)).toBe(true);
    expect(file.rows).toBe(2);
    const sheets = await parseWorkbook(file.buffer, { sheets: ["Days", "Punches"] });
    expect(Object.keys(sheets)).toEqual(expect.arrayContaining(["Days", "Punches"]));
  });

  it("refuses a format it cannot render, rather than silently sending one", async () => {
    await expect(
      toExport({ days: [], punches: [], from: "2026-08-01", to: "2026-08-31", format: "pdf" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("says when the row cap cut the window short", async () => {
    // Rendered as the Punches sheet on purpose: `truncated` must describe what
    // the QUERY returned, not what this particular sheet happened to draw. A
    // caller who asked for punches still needs to know the window was cut.
    const many = Array.from({ length: MAX_ROWS + 1 }, () => dayRow);
    const file = await toExport({ days: many, punches: [punchRow], from: "2026-08-01", to: "2026-08-31", format: "csv", sheet: "punches" });
    expect(file.truncated).toBe(true);
    expect(file.rows).toBe(1);
  });

  it("does not claim truncation on a window that fitted", async () => {
    const file = await toExport({ days: [dayRow], punches: [punchRow], from: "2026-08-01", to: "2026-08-31", format: "csv" });
    expect(file.truncated).toBe(false);
  });

  it("locks a formula-shaped employee name instead of writing it live", async () => {
    const file = await toExport({
      days: [{ ...dayRow, employee_name: "=cmd|'/c calc'!A1" }],
      punches: [],
      from: "2026-08-01",
      to: "2026-08-31",
      format: "csv",
    });
    expect(file.buffer.toString("utf8")).not.toMatch(/(^|,|")=cmd/);
  });
});
