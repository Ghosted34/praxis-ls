"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./attendance.service");
const reconcile = require("./attendance.reconcile");
const { resolveContext } = require("../../../services/spreadsheet");

const base = makeController(service, "Attendance");
const actor = (req) => req.user || { user_id: null };

/** Ship a built export. The filename is the guide's contract
 *  (`attendance-{from}-{to}.{ext}`); `X-Praxis-Truncated` says so out loud when
 *  the row cap cut the window short, so a caller downloading a year for the
 *  whole company is not silently handed a prefix of it. */
function sendFile(res, file) {
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
  if (file.truncated) res.setHeader("X-Praxis-Truncated", "1");
  res.send(file.buffer);
}

module.exports = {
  ...base,

  // ── Self-service time clock ──
  clockIn: asyncHandler(async (req, res) => {
    // Same rule as registerDevice: the header is the browser's own claim and
    // wins over anything the body says about itself.
    const body = req.body.device
      ? { ...req.body, device: { ...req.body.device, user_agent: req.get("user-agent") || req.body.device.user_agent || null } }
      : req.body;
    const row = await req.tenantDb((c) => service.clockIn(c, { ...body, actor: actor(req) }));
    res.status(201).json({ data: row });
  }),
  clockOut: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.clockOut(c, { ...req.body, actor: actor(req) }));
    res.json({ data: row });
  }),
  open: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.open(c, { employeeId: req.query.employee_id || null, actor: actor(req) }));
    res.json({ data: row });
  }),

  // Manager view: who hasn't clocked in on a given day.
  absence: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.absence(c, { date: req.query.date || null })) });
  }),

  /**
   * Geoapify place search for the worksite form.
   *
   * NOT wrapped in `req.tenantDb`. The other handlers here take a connection
   * because they read or write; this one only calls an HTTP provider, and the
   * geoapify service's contract is explicit that callers must be OUTSIDE a
   * transaction so the round trip never holds a pooled connection open — on a
   * topology with a 12-connection-per-tenant ceiling, a stalled provider would
   * otherwise take the tenant's whole pool with it.
   */
  placeSearch: asyncHandler(async (req, res) => {
    const { q, country, limit } = req.validatedQuery;
    res.json({ data: await service.searchPlaces(q, { country, limit }) });
  }),

  // ── Registered devices ──
  listDevices: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listDevices(c, { employee_id: req.query.employee_id || null })) })),
  registerDevice: asyncHandler(async (req, res) => {
    // The user agent is taken from the REQUEST HEADER, not from the body, even
    // though the body may carry one: the header is what the browser actually
    // sent. A self-reported string is still stored when the header is absent
    // (some installed-PWA webviews), but it never overrides the real one.
    const device = { ...req.body.device, user_agent: req.get("user-agent") || req.body.device.user_agent || null };
    const row = await req.tenantDb((c) => service.registerDevice(c, { employeeId: req.body.employee_id || null, device, actor: actor(req) }));
    res.status(201).json({ data: row });
  }),
  renameOwnDevice: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.renameOwnDevice(c, { id: req.params.deviceId, label: req.body.label, actor: actor(req) })) })),
  updateDevice: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.setDeviceStatus(c, { id: req.params.deviceId, patch: req.body, actor: actor(req) })) })),

  // ── Worksites (geofence centres) ──
  listSites: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listSites(c)) })),
  createSite: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createSite(c, { data: req.body, actor: actor(req) })) })),
  updateSite: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.updateSite(c, { id: req.params.siteId, patch: req.body, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Worksite not found", 404);
    res.json({ data: row });
  }),

  /* ── Reconciled days (0697) ──────────────────────────────────────────────
   *
   * `daysFor` is the month a manager reviews and the month an employee sees;
   * `setJustified` is the ONE place a lateness decision changes money, called
   * by both the query inbox and the payroll review sheet so the two can never
   * show different answers.
   */
  days: asyncHandler(async (req, res) => {
    const { from, to, employee_id: employeeId } = req.validatedQuery;
    res.json({ data: await req.tenantDb((c) => reconcile.daysFor(c, { employeeId: employeeId || null, from, to })) });
  }),
  myDays: asyncHandler(async (req, res) => {
    const eid = req.user.employee_id;
    if (!eid) return res.json({ data: [] });
    const { from, to } = req.validatedQuery;
    return res.json({ data: await req.tenantDb((c) => reconcile.daysFor(c, { employeeId: eid, from, to })) });
  }),
  justifyDay: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => reconcile.setJustified(c, {
      id: req.params.dayId, justified: req.body.justified,
      justification: req.body.justification ?? null, actor: actor(req),
    }));
    if (!row) throw new AppError("NOT_FOUND", "Attendance day not found", 404);
    res.json({ data: row });
  }),
  // Re-run a date by hand — after a punch is corrected, a leave is approved
  // late, or a rule is switched on. Idempotent by construction (see the
  // reconciler), so this is safe to press twice.
  runReconcile: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => reconcile.reconcileDate(c, { date: req.body.date || null, actor: actor(req) })) })),

  /* ── History, analytics and the download (PR2) ───────────────────────────
   *
   * `/mine` takes NO grant — an employee is always entitled to their own
   * attendance — and reaches a different service function from the HR one, so
   * an unresolved employee can never fall through to the whole company. See
   * attendance.service's note on the self variants.
   */
  analytics: asyncHandler(async (req, res) => {
    const { from, to, employee_id: employeeId, employee_ids: employeeIds, department } = req.validatedQuery;
    res.json({
      data: await req.tenantDb((c) => service.analytics(c, {
        from, to, employeeId: employeeId || null, employeeIds: employeeIds || null, department: department || null,
      })),
    });
  }),
  myAnalytics: asyncHandler(async (req, res) => {
    const { from, to } = req.validatedQuery;
    res.json({ data: await req.tenantDb((c) => service.myAnalytics(c, { from, to, actor: actor(req) })) });
  }),

  myPunches: asyncHandler(async (req, res) => {
    const { from, to } = req.validatedQuery;
    res.json({ data: await req.tenantDb((c) => service.myPunches(c, { from, to, actor: actor(req) })) });
  }),

  /**
   * The download.
   *
   * `resolveContext` runs INSIDE `req.tenantDb`, alongside the rows, because
   * that is the contract services/spreadsheet states: production callers
   * resolve the tenant's brand/currency context on their tenant connection and
   * hand it to the builder, which stays pure. Skipping it would ship an
   * unbranded file, which the toolkit permits only so unit tests can build
   * without a database.
   */
  exportWindow: asyncHandler(async (req, res) => {
    const { from, to, employee_id: employeeId, employee_ids: employeeIds, department, format, sheet } = req.validatedQuery;
    const file = await req.tenantDb(async (c) => {
      const context = await resolveContext(c, { title: `Attendance ${from} → ${to}`, env: req.env, actor: req.user || null });
      return service.exportWindow(c, {
        from, to,
        employeeId: employeeId || null,
        employeeIds: employeeIds || null,
        department: department || null,
        format: format || "xlsx",
        sheet: sheet || "days",
        context,
        env: req.env,
      });
    });
    sendFile(res, file);
  }),
  myExport: asyncHandler(async (req, res) => {
    const { from, to, format, sheet } = req.validatedQuery;
    const file = await req.tenantDb(async (c) => {
      const context = await resolveContext(c, { title: `My attendance ${from} → ${to}`, env: req.env, actor: req.user || null });
      return service.myExport(c, {
        from, to, format: format || "xlsx", sheet: sheet || "days", context, env: req.env, actor: actor(req),
      });
    });
    sendFile(res, file);
  }),

  // Admin clock-out on a specific row (kept for corrections).
  clockOutById: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.clockOut(c, { id: req.params.id, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Attendance not found", 404);
    res.json({ data: row });
  }),
};
