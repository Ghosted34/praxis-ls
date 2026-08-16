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

/* ── Reconciled days (0697) ────────────────────────────────────────────────
 *
 * The window is REQUIRED, and bounded. `daysFor` returns one row per employee
 * per day: an unbounded range on a 300-person roster is six figures of rows for
 * a screen showing a month, and an open-ended default is how that happens by
 * accident. 92 days is a quarter — the longest window any of the screens ask
 * for — and asking for more is a report, not a page.
 */
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in the form YYYY-MM-DD");
const dayWindow = z
  .object({ from: d, to: d, employee_id: z.string().uuid().optional() })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "The end of the window must not precede its start." })
  .refine(
    (v) => (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 92,
    { path: ["to"], message: "Ask for at most a quarter at a time." },
  );

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

const schemas = { create, update: create.partial(), clockIn, clockOut, workSite, workSiteUpdate: workSite.partial(), placeSearch, deviceRegister, deviceUpdate, deviceRename, dayWindow, justify, reconcileRun };

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
  justify: mw("justify"),
  reconcileRun: mw("reconcileRun"),
  schemas,
};
