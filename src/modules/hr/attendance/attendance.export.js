/**
 * Attendance export (PR2) — payroll-shaped CSV and XLSX.
 *
 * ── THE COLUMN KEYS ARE A CONTRACT, NOT A LAYOUT ───────────────────────────
 *
 * Payroll consumes these files. `DAYS_KEYS` and `PUNCH_KEYS` below are the
 * frozen list from the engineering guide (§3.5) and a test pins them, because
 * renaming one is not a cosmetic change — it is a silent break in somebody
 * else's month-end. Add a column at the END if something is genuinely missing;
 * do not rename, reorder or drop one to tidy up the sheet.
 *
 * ── WHY THE HOUSE TOOLKIT AND NOT AN ExcelJS WRITER ────────────────────────
 *
 * `services/spreadsheet` already owns the one server-side spreadsheet writer:
 * brand colours, the cover sheet with entity identity, the TEST SANDBOX stamp,
 * currency decimals from the tenant's own base currency, and the
 * formula-injection lock that stops `=cmd|…` in an employee name from
 * executing when payroll opens the file. A private ExcelJS writer here would
 * reimplement all five, and would get the last one wrong.
 *
 * ── EXPORT IS A REPORT, NOT A PAGE ─────────────────────────────────────────
 *
 * One file, one window, a hard row cap. The interactive table pages; this does
 * not, so the cap is what stops "download the year for 400 people" from
 * becoming a request that builds a 2 GB workbook in tenant-pool memory.
 */
"use strict";

const { buildCsv, buildWorkbook } = require("../../../services/spreadsheet");
const { AppError } = require("../../../utils/errors");
const { locationStatus } = require("./attendance.location");
const { weekdayOf, hhmm } = require("./attendance.calendar");
const { hoursBetween } = require("./attendance.analytics");

/** One file, hard-capped. See the header. Per sheet, not per workbook. */
const MAX_ROWS = 20000;

const CONTENT_TYPE = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * THE FROZEN CONTRACT (guide §3.5). Order matters, names matter.
 * Changing either is a payroll-visible break — read the header first.
 */
const DAYS_KEYS = Object.freeze([
  "employee", "department", "entity", "work_date", "weekday", "expected", "status",
  "expected_start", "first_in", "last_out", "hours", "minutes_late", "on_site",
  "geo_label", "device_label", "device_trusted", "deduction", "waived",
  "justification", "leave_type", "rule_code",
]);

const PUNCH_KEYS = Object.freeze([
  "employee", "clock_in", "clock_out", "lat", "lng", "within_geofence",
  "geo_label", "distance_m", "device", "late",
]);

/** English 3-letter weekday. Deliberately NOT localized: the sheet is a data
 *  file a payroll system parses, and a column that says "Lun" in one tenant and
 *  "Mon" in the next is not parseable. The workbook's prose (cover, headers)
 *  follows the tenant language; this cell is data. */
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const daysColumns = () => [
  { header: "Employee", key: "employee", width: 26 },
  { header: "Department", key: "department", width: 18 },
  { header: "Entity", key: "entity", width: 22 },
  { header: "Work date", key: "work_date", width: 13, format: "date" },
  { header: "Weekday", key: "weekday", width: 9 },
  {
    header: "Expected",
    key: "expected",
    width: 10,
    format: "bool",
    note: "Was this a working day for this employee — from the entity working calendar and their own overrides, not the tenant weekend alone.",
  },
  { header: "Status", key: "status", width: 12 },
  { header: "Expected start", key: "expected_start", width: 13 },
  { header: "First in", key: "first_in", width: 18, format: "datetime" },
  { header: "Last out", key: "last_out", width: 18, format: "datetime" },
  { header: "Hours", key: "hours", width: 9, format: "num", total: true },
  { header: "Minutes late", key: "minutes_late", width: 12, format: "int", total: true },
  {
    header: "Location",
    key: "on_site",
    width: 12,
    note: "on_site / off_site / no_gps / unfenced. A word rather than yes/no: 'no' would merge a punch taken elsewhere with one that carried no fix at all, and telling those apart is the point of the location_source column.",
  },
  { header: "Place", key: "geo_label", width: 28 },
  { header: "Device", key: "device_label", width: 20 },
  { header: "Device trusted", key: "device_trusted", width: 13, format: "bool" },
  { header: "Deduction", key: "deduction", width: 14, format: "money", total: true },
  { header: "Waived", key: "waived", width: 9, format: "bool" },
  { header: "Justification", key: "justification", width: 36, wrap: true },
  { header: "Leave type", key: "leave_type", width: 18 },
  { header: "Rule", key: "rule_code", width: 14 },
];

const punchColumns = () => [
  { header: "Employee", key: "employee", width: 26 },
  { header: "Clock in", key: "clock_in", width: 18, format: "datetime" },
  { header: "Clock out", key: "clock_out", width: 18, format: "datetime" },
  {
    header: "Latitude",
    key: "lat",
    width: 12,
    format: "qty",
    note: "Stored to six decimal places. The cell holds the exact value; the column simply displays fewer.",
  },
  { header: "Longitude", key: "lng", width: 12, format: "qty" },
  { header: "Within geofence", key: "within_geofence", width: 14, format: "bool" },
  { header: "Place", key: "geo_label", width: 28 },
  { header: "Distance (m)", key: "distance_m", width: 12, format: "qty" },
  { header: "Device", key: "device", width: 20 },
  { header: "Late", key: "late", width: 8, format: "bool" },
];

const text = (v) => (v === null || v === undefined || v === "" ? null : String(v));
const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Reconciled days → export rows.
 *
 * `expectedFor` is the SAME resolver analytics uses (attendance.calendar). When
 * a caller has none, `expected` is left null rather than guessed from the
 * status — a punch on a non-working day reconciles as PRESENT, so the status
 * cannot answer "was this owed as work".
 */
function daysRows(days = [], { expectedFor = null } = {}) {
  const knowsExpected = typeof expectedFor === "function";
  return days.slice(0, MAX_ROWS).map((d) => {
    const workDate = String(d.work_date || "").slice(0, 10);
    const weekday = weekdayOf(workDate);
    let expected = null;
    if (knowsExpected) {
      let exp = null;
      try {
        exp = expectedFor(d.employee_id, workDate);
      } catch {
        exp = null;
      }
      if (exp) expected = !!exp.isWorkingDay && !exp.isHoliday;
    }
    return {
      employee: text(d.employee_name),
      department: text(d.department),
      entity: text(d.entity_name),
      work_date: workDate || null,
      weekday: weekday === null ? null : WEEKDAY[weekday],
      expected,
      status: text(d.status),
      expected_start: hhmm(d.expected_start_time),
      first_in: d.first_clock_in_at || null,
      last_out: d.last_clock_out_at || null,
      hours: hoursBetween(d.first_clock_in_at, d.last_clock_out_at) || null,
      minutes_late: numOrNull(d.minutes_late) || 0,
      on_site: d.attendance_id ? locationStatus(d) : null,
      geo_label: text(d.geo_label),
      device_label: text(d.device_label),
      device_trusted: d.device_trusted === null || d.device_trusted === undefined ? null : !!d.device_trusted,
      deduction: numOrNull(d.deduction_amount) || 0,
      waived: !!d.justified,
      justification: text(d.justification),
      leave_type: text(d.leave_type_name),
      rule_code: text(d.rule_code),
    };
  });
}

/** Punches → export rows. `is_late` is decorated by the service (pure lateness
 *  against the workplace clock), so this only reads it. */
function punchRows(punches = []) {
  return punches.slice(0, MAX_ROWS).map((p) => ({
    employee: text(p.employee_name),
    clock_in: p.clock_in_at || null,
    clock_out: p.clock_out_at || null,
    lat: numOrNull(p.latitude),
    lng: numOrNull(p.longitude),
    within_geofence:
      p.within_geofence === null || p.within_geofence === undefined ? null : !!p.within_geofence,
    geo_label: text(p.geo_label),
    distance_m: numOrNull(p.distance_m),
    device: text(p.device_label),
    late: p.is_late === null || p.is_late === undefined ? null : !!p.is_late,
  }));
}

/** `attendance-2026-08-01-2026-08-31.xlsx`, per the guide. The SANDBOX segment
 *  is the one addition: a Test-mode file named exactly like a live one is a
 *  compliance hazard the moment somebody forwards it to payroll. */
function exportName({ from, to, extension, env = null }) {
  const safe = (v) => String(v || "").replace(/[^0-9-]/g, "").slice(0, 10) || "unset";
  const stem = `attendance-${safe(from)}-${safe(to)}`;
  return env === "sandbox" ? `${stem}-SANDBOX.${extension}` : `${stem}.${extension}`;
}

/**
 * Render the window to a downloadable buffer.
 *
 * XLSX carries BOTH sheets — Days and Punches — because they are one export in
 * one file. CSV cannot hold two sheets, so it carries Days unless `sheet` asks
 * for punches; that is a format limit, not a second export.
 *
 * @param {Object}   opts
 * @param {Object[]} opts.days
 * @param {Object[]} opts.punches
 * @param {string}   opts.from
 * @param {string}   opts.to
 * @param {string}   [opts.format] csv | xlsx (default xlsx)
 * @param {string}   [opts.sheet]  days | punches — CSV only
 * @param {Object}   [opts.context] WorkbookContext from `resolveContext`,
 *                   resolved by the controller inside its tenant connection.
 * @param {Function} [opts.expectedFor] the calendar resolver, for `expected`.
 * @returns {Promise<{buffer:Buffer, contentType:string, extension:string, filename:string, rows:number, truncated:boolean}>}
 */
async function toExport({
  days = [],
  punches = [],
  from,
  to,
  format = "xlsx",
  sheet = "days",
  context = null,
  expectedFor = null,
  env = null,
} = {}) {
  const fmt = String(format || "xlsx").toLowerCase();
  const which = String(sheet || "days").toLowerCase() === "punches" ? "punches" : "days";
  const truncated = days.length > MAX_ROWS || punches.length > MAX_ROWS;

  if (fmt === "csv") {
    const columns = which === "punches" ? punchColumns() : daysColumns();
    const rows = which === "punches" ? punchRows(punches) : daysRows(days, { expectedFor });
    return {
      buffer: buildCsv({ columns, rows, context }),
      contentType: CONTENT_TYPE.csv,
      extension: "csv",
      filename: exportName({ from, to, extension: "csv", env }),
      rows: rows.length,
      truncated,
    };
  }

  if (fmt !== "xlsx") {
    throw new AppError("UNSUPPORTED_FORMAT", `Export format must be csv or xlsx (got '${format}').`, 422);
  }

  const dayRows = daysRows(days, { expectedFor });
  const punchRowsOut = punchRows(punches);
  const buffer = await buildWorkbook({
    sheets: [
      { name: "Days", title: `Attendance ${from} → ${to}`, columns: daysColumns(), rows: dayRows, freeze: true },
      { name: "Punches", title: `Punches ${from} → ${to}`, columns: punchColumns(), rows: punchRowsOut, freeze: true },
    ],
    context,
    // A file that circulates to payroll gets the identity cover: who exported
    // it, from which entity, in which environment.
    cover: !!context,
  });
  return {
    buffer,
    contentType: CONTENT_TYPE.xlsx,
    extension: "xlsx",
    filename: exportName({ from, to, extension: "xlsx", env }),
    rows: dayRows.length + punchRowsOut.length,
    truncated,
  };
}

module.exports = {
  toExport,
  daysRows,
  punchRows,
  daysColumns,
  punchColumns,
  exportName,
  DAYS_KEYS,
  PUNCH_KEYS,
  MAX_ROWS,
  CONTENT_TYPE,
};
