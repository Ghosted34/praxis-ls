"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./attendance.service");

const base = makeController(service, "Attendance");
const actor = (req) => req.user || { user_id: null };

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

  // Admin clock-out on a specific row (kept for corrections).
  clockOutById: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.clockOut(c, { id: req.params.id, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Attendance not found", 404);
    res.json({ data: row });
  }),
};
