"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

const create = z.object({
  employee_id: z.string().uuid().optional(),
  clock_in_at: z.string().optional(),
  clock_out_at: z.string().optional(),
  location: z.record(z.any()).optional(),
});

/**
 * The device presented with a punch (0524).
 *
 * `fingerprint` is client-generated and OPAQUE — nothing here parses it, and it
 * is capped at both ends so a hostile client can neither send a one-character
 * token that collides with everybody else's nor use the column as free storage.
 * The strings that follow are self-reported and go straight into a table a
 * manager reads, so they are length-capped for the same reason.
 */
const deviceInfo = z.object({
  fingerprint: z.string().min(8).max(200),
  label: z.string().max(80).optional(),
  user_agent: z.string().max(400).optional(),
  platform: z.string().max(80).optional(),
});

const clockIn = z.object({
  employee_id: z.string().uuid().optional(), // omitted = self (from the auth'd user)
  latitude: lat.optional(),
  longitude: lng.optional(),
  accuracy: z.number().nonnegative().optional(),
  // Optional: the tenant's `hr.device_policy` decides whether its absence
  // matters, not this schema. Making it required here would have broken every
  // client that predates the register, including the installed PWA people are
  // already clocking in from.
  device: deviceInfo.optional(),
});

const deviceRegister = z.object({
  employee_id: z.string().uuid().optional(),
  device: deviceInfo,
});

/** Rename and/or decide. TRUSTED and REVOKED only — nothing may be pushed BACK
 *  to PENDING, which would erase the fact that somebody had already decided. */
const deviceUpdate = z.object({
  label: z.string().min(1).max(80).optional(),
  status: z.enum(["TRUSTED", "REVOKED"]).optional(),
}).refine((v) => v.label !== undefined || v.status !== undefined, {
  message: "Nothing to change",
});

const clockOut = z.object({
  id: z.string().uuid().optional(), // omitted = the caller's open shift
  employee_id: z.string().uuid().optional(),
  latitude: lat.optional(),
  longitude: lng.optional(),
});

const workSite = z.object({
  name: z.string().min(1),
  latitude: lat,
  longitude: lng,
  radius_m: z.coerce.number().int().positive().max(50000).optional(),
  entity_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional(),
});

/**
 * Worksite place search (query string, not a body).
 *
 * `country` is capped at two letters HERE rather than passed through, because it
 * lands in the provider's own `filter=countrycode:` grammar — the one place in
 * this module where an unconstrained string could smuggle a second filter clause
 * upstream. geoapify.service re-checks it; this is the outer of the two.
 */
const placeSearch = z.object({
  q: z.string().min(1).max(200),
  country: z.string().regex(/^[A-Za-z]{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

/* ── Reconciled days (0697), widened for history + analytics (PR2) ─────────
 *
 * The window is REQUIRED, and bounded. `daysFor` returns one row per employee
 * per day, so an unbounded range on a 300-person roster is six figures of rows
 * and an open-ended default is how that happens by accident. Both of those
 * remain true. What changed is the ceiling and WHY it sits where it does.
 *
 * IT WAS 92 DAYS — a quarter — on the reasoning that a quarter was the longest
 * window any screen asked for, and that anything longer was "a report, not a
 * page". The first half of that has stopped being true: My HR and the HR
 * history tab both offer a YEAR chip, and the payroll-shaped download exists
 * precisely to answer "the last twelve months". Under a 92-day cap the year
 * view was not merely absent, it was a 422 — the screen could offer a button
 * the API refused.
 *
 * The second half was always the real argument, and it is now enforced where
 * it belongs instead of by a date arithmetic that could not tell the two apart:
 *
 *   · 366 days, not 365 — a leap year asked for as 2028-01-01 → 2028-12-31 is
 *     366 days inclusive, and a cap that rejects one calendar year in four is
 *     a bug that surfaces once and confusingly.
 *   · The ROW ceiling moved to `daysFor` (DAYS_LIMIT) and to the export, which
 *     is where the cost actually is. A year for one employee is 366 rows; a
 *     year for a whole company is capped and reports that it was.
 *
 * So the window is a bound on the QUESTION, and the row cap is the bound on the
 * ANSWER. Keeping only the first is what made a legitimate year illegal.
 */
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in the form YYYY-MM-DD");
/** The longest window any surface offers: one year, leap years included. */
const MAX_WINDOW_DAYS = 366;
const windowShape = (shape) =>
  z
    .object({ from: d, to: d, ...shape })
    .refine((v) => v.to >= v.from, { path: ["to"], message: "The end of the window must not precede its start." })
    .refine(
      (v) => (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= MAX_WINDOW_DAYS,
      { path: ["to"], message: "Ask for at most a year at a time." },
    );

const dayWindow = windowShape({ employee_id: z.string().uuid().optional() });

/**
 * `employee_ids` off a query string.
 *
 * Express hands this over as a bare string for one value, an array for
 * `?employee_ids=a&employee_ids=b`, and people paste comma-separated lists into
 * URLs regardless. All three normalise to an array here so the SQL builder only
 * ever sees one shape — and each element is still checked as a uuid, because
 * the array reaches Postgres as a `uuid[]` bind and a non-uuid in it is a 500
 * from the driver rather than a 422 the caller can read.
 *
 * CAPPED AT 50. It is the compare set on a table a person reads across, not a
 * bulk selector, and it bounds the `= ANY($n)` array.
 */
const MAX_EMPLOYEE_IDS = 50;
const employeeIds = z
  .preprocess((v) => {
    if (v === undefined || v === null || v === "") return undefined;
    const list = Array.isArray(v) ? v : String(v).split(",");
    return list.map((x) => String(x).trim()).filter(Boolean);
  }, z.array(z.string().uuid()).max(MAX_EMPLOYEE_IDS, `Compare at most ${MAX_EMPLOYEE_IDS} employees at a time.`))
  .optional();

/** Free text on the employee row (0490 keeps it as the display snapshot beside
 *  `scope_id`), matched case-insensitively downstream. Capped so it cannot be
 *  used as a large bind value. */
const department = z.string().trim().min(1).max(120).optional();

/** History + analytics: a window, a compare set, a department. */
const analyticsWindow = windowShape({
  employee_id: z.string().uuid().optional(),
  employee_ids: employeeIds,
  department,
});

/**
 * The download. `format` decides the file; `sheet` only means anything for csv,
 * which cannot carry two sheets — the xlsx always carries both (see
 * attendance.export). Defaults render the Days sheet as xlsx, which is what
 * payroll asks for.
 */
const exportWindow = windowShape({
  employee_id: z.string().uuid().optional(),
  employee_ids: employeeIds,
  department,
  format: z.enum(["csv", "xlsx"]).optional(),
  sheet: z.enum(["days", "punches"]).optional(),
});

/** The caller's own punches over a range — no selector at all, by construction:
 *  there is nothing on this schema that could name another employee. */
const punchWindow = windowShape({});

/**
 * The map window (PR3). Deliberately the same shape as `punchWindow` — NO
 * employee selector of any kind.
 *
 * The map's scope is decided in the controller from the caller's grants, and a
 * selector here would be a second, contradictory answer to the same question:
 * a schema that accepts `employee_id` invites a handler that honours it, and
 * the first one that does hands an ungated route somebody else's coordinates.
 * There is nothing to forget to check if there is nothing to check.
 */
const mapWindow = windowShape({});

/**
 * The weekly backfill body. Both dates optional — omitted means "the last
 * completed week in the tenant's zone", which is what the nightly job runs and
 * therefore what "run it now" should mean without arguments.
 *
 * `week_end` alone is enough to name a week (the composer derives the start
 * from it), so `week_start` is only honoured alongside it; a start without an
 * end would be an open-ended window, and this writes queries.
 */
const weeklyRun = z
  .object({ week_start: d.optional(), week_end: d.optional() })
  .refine((v) => !v.week_start || !!v.week_end, {
    path: ["week_end"],
    message: "Give the end of the week too, or neither.",
  })
  .refine((v) => !v.week_start || !v.week_end || v.week_end >= v.week_start, {
    path: ["week_end"],
    message: "The end of the week must not precede its start.",
  });

/** Waiving keeps the deduction figure (see 0697) — this only decides whether
 *  payroll counts it. A waiver takes a reason; upholding does not need one. */
const justify = z
  .object({ justified: z.boolean(), justification: z.string().max(1000).optional() })
  .refine((v) => !v.justified || !!(v.justification && v.justification.trim()), {
    path: ["justification"],
    message: "Say why this day is being waived.",
  });

const reconcileRun = z.object({ date: d.optional() });

/** Self-service rename. LABEL ONLY — there is deliberately no `status` key, so
 *  the employee-facing grant this rides on can never approve a device. */
const deviceRename = z.object({ label: z.string().trim().min(1).max(80) });

const schemas = { create, update: create.partial(), clockIn, clockOut, workSite, workSiteUpdate: workSite.partial(), placeSearch, deviceRegister, deviceUpdate, deviceRename, dayWindow, analyticsWindow, exportWindow, punchWindow, mapWindow, weeklyRun, justify, reconcileRun };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

/** Same as `mw`, against req.query — the body middleware would reject every GET. */
const qmw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.query);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid query", 422, p.error.flatten().fieldErrors));
  req.validatedQuery = p.data;
  return next();
};

module.exports = {
  create: mw("create"),
  update: mw("update"),
  clockIn: mw("clockIn"),
  clockOut: mw("clockOut"),
  workSite: mw("workSite"),
  workSiteUpdate: mw("workSiteUpdate"),
  placeSearch: qmw("placeSearch"),
  deviceRegister: mw("deviceRegister"),
  deviceUpdate: mw("deviceUpdate"),
  deviceRename: mw("deviceRename"),
  dayWindow: qmw("dayWindow"),
  analyticsWindow: qmw("analyticsWindow"),
  exportWindow: qmw("exportWindow"),
  punchWindow: qmw("punchWindow"),
  mapWindow: qmw("mapWindow"),
  weeklyRun: mw("weeklyRun"),
  justify: mw("justify"),
  reconcileRun: mw("reconcileRun"),
  schemas,
  MAX_WINDOW_DAYS,
  MAX_EMPLOYEE_IDS,
};
